//! The way in, for the one thing that is allowed to ask.
//!
//! An agent's hands live in Rust behind Tauri's IPC, which only colai's own page can
//! reach. The thing that needs to reach them is a node worker written in TypeScript, so
//! there has to be a door: a private socket speaking the same `computer.act` vocabulary
//! the rest of this module already parses.
//!
//! **Whoever can write to this socket can drive input.** So it lives in
//! `$XDG_RUNTIME_DIR`, which the system gives one user and mode 0700, and it is created
//! 0600 on top of that. That is the same boundary the X session itself has: anybody who
//! can open this can already open the display and drive the pointer directly, so the
//! door grants nothing that was not already granted. It is deliberately not a TCP port —
//! a port is reachable by anything on the machine, and this one moves somebody's hands.
//!
//! One line of JSON in, one line out. A line is a whole request, which means a caller
//! that dies mid-write loses its own request and nobody else's.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::fs::PermissionsExt as _;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// What somebody outside can ask for.
///
/// Two things only. Everything else colai can do stays behind Tauri where the page is
/// the only caller — a door is a place to be careful about, so it opens onto as little
/// as possible.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub(super) enum Asked {
    /// Whether this desktop gives an agent a cursor of its own.
    Honours,
    /// One agent, one window, one action.
    Act {
        agent: String,
        /// The X window id, as hex. Absent means "wherever this agent's focus is",
        /// which a click can live with and a keystroke should not.
        #[serde(default)]
        window: Option<String>,
        act: super::Act,
    },
}

/// What goes back.
///
/// Always a shape, never a bare string: the caller is a program, and "did it work" has
/// to survive being read by something that cannot squint at prose.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Answered {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    honours: Option<super::Honours>,
}

impl Answered {
    fn fine() -> Self {
        Self {
            ok: true,
            error: None,
            honours: None,
        }
    }

    fn refused(why: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(why.into()),
            honours: None,
        }
    }
}

/// Where the door is.
///
/// Under the runtime directory, which is per-user, mode 0700, and cleared at logout —
/// so a stale socket cannot outlive the session that made it.
pub(super) fn where_at() -> PathBuf {
    let run = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    run.join("colai-hands.sock")
}

/// Read one line and work out what it wants.
///
/// Pure, so every shape of malformed request is a test rather than something discovered
/// on a socket at runtime.
pub(super) fn asked(line: &str) -> Result<Asked, String> {
    serde_json::from_str::<Asked>(line.trim())
        .map_err(|error| format!("that is not something colai's hands can be asked: {error}"))
}

/// Turn an asked-for window into the id the hands take.
///
/// Hex as X and the rest of the toolbar write it. Zero means "wherever the focus already
/// is" — fine for a click, and the reason a keystroke without a window is worth thinking
/// twice about.
pub(super) fn window_id(window: Option<&str>) -> u64 {
    window
        .and_then(|hex| hex.strip_prefix("0x"))
        .and_then(|hex| u64::from_str_radix(hex, 16).ok())
        .unwrap_or(0)
}

/// Open the door, and keep it open until colai goes away.
pub(super) fn open() {
    let path = where_at();
    // A socket file left by a crash makes `bind` fail with "address in use" for ever.
    // Removing it is safe because the runtime directory belongs to this user alone.
    let _ = std::fs::remove_file(&path);
    let Ok(listener) = UnixListener::bind(&path) else {
        eprintln!("colai hands: could not open {}", path.display());
        return;
    };
    // 0600 on top of the directory's 0700. Belt and braces on the one file in colai
    // that moves somebody's hands.
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));

    std::thread::Builder::new()
        .name("colai-hands-door".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                // A thread per caller. There is normally one, and a slow or wedged
                // client must not be able to hold the door shut against the others.
                let _ = std::thread::Builder::new()
                    .name("colai-hands-caller".into())
                    .spawn(move || serve(stream));
            }
        })
        .ok();
}

fn serve(stream: UnixStream) {
    let Ok(writing) = stream.try_clone() else {
        return;
    };
    let mut writing = writing;
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let answer = match asked(&line) {
            Err(why) => Answered::refused(why),
            Ok(Asked::Honours) => Answered {
                ok: true,
                error: None,
                honours: Some(super::honours()),
            },
            Ok(Asked::Act { agent, window, act }) => {
                match super::act(&agent, window_id(window.as_deref()), &act) {
                    Ok(()) => Answered::fine(),
                    Err(why) => Answered::refused(why),
                }
            }
        };
        let Ok(mut said) = serde_json::to_vec(&answer) else {
            continue;
        };
        said.push(b'\n');
        if writing.write_all(&said).is_err() {
            return;
        }
        let _ = writing.flush();
    }
}

/// Take the door away, so nothing is left holding a path into a process that has gone.
pub(super) fn close() {
    let _ = std::fs::remove_file(where_at());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_says_which_of_the_two_things_it_wants() {
        assert_eq!(asked(r#"{"op": "honours"}"#).unwrap(), Asked::Honours);
        // Whitespace and trailing newlines are how a line arrives off a socket.
        assert_eq!(asked("  {\"op\": \"honours\"}\n").unwrap(), Asked::Honours);

        let act = asked(
            r#"{"op": "act", "agent": "ana", "window": "0x4600007",
                 "act": {"action": "left_click", "x": 10, "y": 20}}"#,
        )
        .unwrap();
        let Asked::Act { agent, window, .. } = act else {
            panic!("that was an act");
        };
        assert_eq!(agent, "ana");
        assert_eq!(window.as_deref(), Some("0x4600007"));
    }

    #[test]
    fn a_window_is_optional_because_a_click_does_not_need_one() {
        let act =
            asked(r#"{"op": "act", "agent": "ana", "act": {"action": "mouse_move"}}"#).unwrap();
        let Asked::Act { window, .. } = act else {
            panic!("that was an act");
        };
        assert_eq!(window, None);
    }

    #[test]
    fn nonsense_on_the_socket_is_refused_rather_than_guessed_at() {
        // Anything that can reach this door can move somebody's hands, so a request that
        // does not say exactly what it wants gets nothing rather than a best effort.
        for line in [
            "",
            "{",
            "null",
            "[]",
            r#"{"op": "quit"}"#,
            r#"{"op": "act", "agent": "ana"}"#,
            r#"{"op": "act", "act": {"action": "left_click"}}"#,
            r#"{"op": "act", "agent": "ana", "act": {"action": "screenshot"}}"#,
        ] {
            assert!(asked(line).is_err(), "{line:?} should be refused");
        }
    }

    #[test]
    fn a_window_id_is_read_as_x_writes_it() {
        assert_eq!(window_id(Some("0x4600007")), 0x4600007);
        assert_eq!(window_id(Some("0x1")), 1);
        // Not said, or said in a way X never writes: zero, which means "wherever the
        // focus is" rather than window number zero.
        assert_eq!(window_id(None), 0);
        assert_eq!(window_id(Some("4600007")), 0);
        assert_eq!(window_id(Some("nonsense")), 0);
    }

    #[test]
    fn the_door_is_in_the_one_directory_the_system_keeps_private() {
        // Not a TCP port, and not /tmp: anything on the machine can reach both, and this
        // one moves somebody's hands.
        let path = where_at();
        assert_eq!(path.file_name().unwrap(), "colai-hands.sock");
        assert!(path.is_absolute());
    }
}
