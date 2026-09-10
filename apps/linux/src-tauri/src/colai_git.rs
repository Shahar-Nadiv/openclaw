//! What a repository looks like right now, read and never written.
//!
//! The branch window needs a graph, and a graph cannot be drawn without asking git for
//! one. So colai reads: `log` and `for-each-ref`, and nothing else, ever.
//!
//! The split is the whole design. **colai reads git; the agent changes it.** Checking out
//! a branch, staging, committing, rebasing — every one of those goes to the agent as a
//! mark, because they are decisions somebody should see a diff before making and this
//! process cannot read a diff. Nothing here can write, and the shape of the code is what
//! makes that true rather than a promise in a comment:
//!
//! - `Reading` is a closed enum. There is no path from a string on the page to a
//!   subcommand.
//! - Each reading maps to one fixed argument vector, written out here in full. The only
//!   value that ever comes from outside is the repository, and it is a path that has been
//!   checked before anything is spawned.
//! - The repository must sit inside a folder the Gateway already says is worked in, and
//!   must itself hold a `.git`.
//!
//! A test asserts the vectors contain no subcommand that can write and none of git's
//! escapes — `-c`, `--exec-path`, `--upload-pack` — which are how a read-only allow-list
//! stops being read-only.

use serde::Serialize;

/// How much history the graph asks for.
///
/// A window's worth and a little more. This repository has eighty-eight thousand commits
/// and a graph of all of them is not a picture of anything; the question the window
/// answers is "what has been happening lately and on which branch", which is a screenful.
const GRAPH_DEEP: usize = 120;

/// How long a reading may take before it is abandoned.
///
/// Generous for a cold repository on a slow disk, short enough that a window opened on a
/// checkout git cannot read does not hang with it.
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(6);

/// The separator between fields of a commit.
///
/// A unit separator rather than a pipe or a tab: a commit subject may contain either, and
/// a subject containing the separator would silently become two fields.
const FIELD: char = '\u{1f}';

/// What may be asked of a repository.
///
/// Closed on purpose. A string from the page cannot become a subcommand because there is
/// nowhere for it to go.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Reading {
    Graph,
    Branches,
}

/// One commit, as the graph draws it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Commit {
    pub hash: String,
    /// Its parents, first one first — which is the line the graph keeps straight.
    pub parents: Vec<String>,
    /// The names pointing at it: branches, tags, HEAD.
    pub refs: Vec<String>,
    pub who: String,
    /// When it was made, in milliseconds, so the page can say "4m" with what it already has.
    pub at: i64,
    pub subject: String,
}

/// One branch, and how far it has drifted from what it tracks.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Branch {
    pub name: String,
    pub head: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// What a reading came back with.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reply {
    pub commits: Vec<Commit>,
    pub branches: Vec<Branch>,
    /// Whether the graph stopped at the cap rather than at the beginning of history.
    ///
    /// Said rather than left to be inferred from a count: a graph that ends mid-history
    /// looks exactly like a repository that started there.
    pub capped: bool,
}

/// The arguments each reading runs, in full.
///
/// Written out rather than assembled, so what git is asked is readable here in one place
/// and cannot be extended by anything that happens at runtime.
fn arguments(what: Reading) -> Vec<String> {
    let deep = format!("-n{GRAPH_DEEP}");
    match what {
        Reading::Graph => vec![
            "log".to_string(),
            "--all".to_string(),
            "--date-order".to_string(),
            "--no-color".to_string(),
            deep,
            format!("--pretty=format:%H{FIELD}%P{FIELD}%D{FIELD}%an{FIELD}%at{FIELD}%s"),
        ],
        Reading::Branches => vec![
            "for-each-ref".to_string(),
            "--no-color".to_string(),
            format!(
                "--format=%(refname:short){FIELD}%(HEAD){FIELD}%(upstream:short){FIELD}%(upstream:track)"
            ),
            "refs/heads".to_string(),
            "refs/remotes".to_string(),
        ],
    }
}

/// Read something about a repository.
///
/// Refuses before it spawns, never after. A path that is not inside somewhere the Gateway
/// says is worked in, or that is not a repository at all, produces a sentence rather than
/// a process.
#[tauri::command]
pub(crate) async fn colai_git_read(
    gateway: tauri::State<'_, crate::gateway_ws::GatewayClient>,
    root: String,
    what: Reading,
) -> Result<Reply, String> {
    let roots = crate::colai_receivers::work_roots(&gateway).await;
    let here = std::path::Path::new(&root);
    if !crate::colai_files::may_read(here, &roots) {
        return Err("That folder is not one of the projects this Gateway is working in.".to_string());
    }
    if !here.join(".git").exists() {
        return Err(format!("{root} is not a git repository."));
    }
    let said = run(&root, what).await?;
    Ok(match what {
        Reading::Graph => {
            let commits = commits_in(&said);
            Reply {
                capped: commits.len() >= GRAPH_DEEP,
                commits,
                branches: Vec::new(),
            }
        }
        Reading::Branches => Reply {
            branches: branches_in(&said),
            ..Reply::default()
        },
    })
}

/// Run one reading, or say why it could not be.
async fn run(root: &str, what: Reading) -> Result<String, String> {
    // `-C` rather than a working directory, so the path is an argument git resolves
    // rather than a state this process has to be in.
    let mut command = tokio::process::Command::new("git");
    command.arg("-C").arg(root).args(arguments(what));
    // Nothing here needs the terminal, and a git that stops to ask something would hang
    // the window it was opened from.
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.stdin(std::process::Stdio::null());
    let finished = tokio::time::timeout(PATIENCE, command.output())
        .await
        .map_err(|_| format!("git did not answer about {root} in time."))?
        .map_err(|error| format!("Could not run git: {error}"))?;
    if !finished.status.success() {
        let said = String::from_utf8_lossy(&finished.stderr);
        let first = said.lines().next().unwrap_or("git refused").trim();
        return Err(format!("git: {first}"));
    }
    Ok(String::from_utf8_lossy(&finished.stdout).to_string())
}

/// Read the commits out of a `log` reply.
fn commits_in(said: &str) -> Vec<Commit> {
    said.lines()
        .filter_map(|line| {
            let mut parts = line.split(FIELD);
            let hash = parts.next()?.trim();
            if hash.is_empty() {
                return None;
            }
            let parents = parts.next().unwrap_or_default();
            let refs = parts.next().unwrap_or_default();
            let who = parts.next().unwrap_or_default();
            let at = parts.next().unwrap_or_default();
            // Last, and taken whole: a subject may contain anything except a newline, and
            // splitting further would cut one containing the separator in half.
            let subject = parts.next().unwrap_or_default();
            Some(Commit {
                hash: hash.to_string(),
                parents: parents
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                refs: refs
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .collect(),
                who: who.trim().to_string(),
                // Seconds from git, milliseconds everywhere in the page.
                at: at.trim().parse::<i64>().unwrap_or_default() * 1000,
                subject: subject.trim().to_string(),
            })
        })
        .collect()
}

/// Read the branches out of a `for-each-ref` reply.
fn branches_in(said: &str) -> Vec<Branch> {
    said.lines()
        .filter_map(|line| {
            let mut parts = line.split(FIELD);
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let head = parts.next().unwrap_or_default().trim() == "*";
            let upstream = parts.next().unwrap_or_default().trim();
            let (ahead, behind) = drifted(parts.next().unwrap_or_default());
            Some(Branch {
                name: name.to_string(),
                head,
                remote: name.contains('/') && !head,
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                ahead,
                behind,
            })
        })
        .collect()
}

/// How far a branch has drifted, out of git's own `[ahead 2, behind 1]`.
///
/// Parsed rather than asked for as two counts, because `%(upstream:track)` is the one
/// field that answers it and this is the shape it answers in. Anything unrecognised —
/// `[gone]`, an empty string — is no drift, which is true of both.
fn drifted(said: &str) -> (u32, u32) {
    let count = |word: &str| -> u32 {
        said.split(word)
            .nth(1)
            .and_then(|rest| {
                rest.trim_start()
                    .split(|c: char| !c.is_ascii_digit())
                    .find(|part| !part.is_empty())
            })
            .and_then(|digits| digits.parse().ok())
            .unwrap_or(0)
    };
    (count("ahead "), count("behind "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_here_can_write() {
        /*
         * The load-bearing claim of this module, checked rather than promised.
         *
         * Every argument vector is written out in `arguments`, so this can read all of
         * them and assert that none names a subcommand that changes anything and none
         * carries one of git's escapes — `-c` sets configuration for the run, and the
         * `--exec-path` and `--upload-pack` family point git at another binary. Those are
         * how a read-only allow-list quietly stops being read-only.
         */
        let writes = [
            "add", "commit", "push", "rebase", "merge", "reset", "checkout", "switch", "rm",
            "mv", "clean", "stash", "apply", "am", "cherry-pick", "revert", "tag", "branch",
            "config", "gc", "prune", "fetch", "pull", "clone", "init", "update-ref", "notes",
            "worktree", "submodule", "filter-branch", "replace", "bisect", "restore",
        ];
        for what in [Reading::Graph, Reading::Branches] {
            let args = arguments(what);
            let first = args.first().expect("a subcommand");
            assert!(
                !writes.contains(&first.as_str()),
                "{first} can change a repository"
            );
            assert!(
                matches!(first.as_str(), "log" | "for-each-ref"),
                "only the two readings, not {first}"
            );
            for arg in &args {
                for escape in ["-c", "--exec-path", "--upload-pack", "--receive-pack", "-C"] {
                    assert!(
                        arg != escape && !arg.starts_with(&format!("{escape}=")),
                        "{arg} is an escape out of the allow-list"
                    );
                }
            }
        }
    }

    #[test]
    fn a_commit_survives_a_subject_that_looks_like_a_field() {
        // Pipes and tabs are ordinary in a commit subject, which is why the separator is
        // one of the characters that is not.
        let line = format!(
            "abc123{FIELD}def456 789aaa{FIELD}HEAD -> main, origin/main{FIELD}Ada{FIELD}1700000000{FIELD}fix: a | b\tc"
        );
        let found = commits_in(&line);
        assert_eq!(found.len(), 1);
        let one = &found[0];
        assert_eq!(one.hash, "abc123");
        assert_eq!(one.parents, vec!["def456", "789aaa"]);
        assert_eq!(one.refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(one.subject, "fix: a | b\tc");
        // Seconds in, milliseconds out, because that is what the page counts in.
        assert_eq!(one.at, 1_700_000_000_000);
    }

    #[test]
    fn a_root_commit_has_no_parents_and_is_still_a_commit() {
        let line = format!("abc{FIELD}{FIELD}{FIELD}Ada{FIELD}1700000000{FIELD}first");
        let found = commits_in(&line);
        assert_eq!(found.len(), 1);
        assert!(found[0].parents.is_empty());
        assert!(found[0].refs.is_empty());
    }

    #[test]
    fn drift_is_read_out_of_gits_own_words() {
        assert_eq!(drifted("[ahead 2, behind 1]"), (2, 1));
        assert_eq!(drifted("[ahead 13]"), (13, 0));
        assert_eq!(drifted("[behind 4]"), (0, 4));
        // A branch whose upstream has gone, and one with no upstream at all: neither has
        // drifted, and neither is an error.
        assert_eq!(drifted("[gone]"), (0, 0));
        assert_eq!(drifted(""), (0, 0));
    }

    #[test]
    fn a_branch_knows_whether_it_is_the_one_you_are_on() {
        let said = format!(
            "main{FIELD}*{FIELD}origin/main{FIELD}[ahead 1]\n\
             origin/main{FIELD} {FIELD}{FIELD}"
        );
        let found = branches_in(&said);
        assert_eq!(found.len(), 2);
        assert!(found[0].head);
        assert!(!found[0].remote);
        assert_eq!(found[0].ahead, 1);
        assert!(found[1].remote);
        assert_eq!(found[1].upstream, None);
    }
}
