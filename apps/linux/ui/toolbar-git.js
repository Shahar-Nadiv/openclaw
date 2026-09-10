// The shape of a repository: which branches there are, and how the commits on them run.
//
// A window rather than a flyout, for the reason the library is one — a graph is not
// recognisable from its name. Every other menu here is a list of words where the thing
// being chosen *is* its name; a branch is a place in a history, and the history is what
// says which place.
//
// It reads and does not write. Checking out a branch and starting one are asks: they
// compose a sentence and open Work with it, so they travel the same path as everything
// else and nothing happens to somebody's checkout behind their back.

/** How tall one commit's row is, and how far apart the columns sit. */
const GRAPH_ROW = 26;
const GRAPH_LANE = 14;
/** How far in the first column sits, so a node is not flush against the edge. */
const GRAPH_EDGE = 10;

/**
 * The colours a lane cycles through.
 *
 * From the toolbar's own tokens rather than a palette of this window's own: a graph in
 * somebody else's colours is a graph that belongs to a different program. Four, because
 * a fifth concurrent branch on screen is rare and repeating is better than inventing a
 * colour nothing else here uses.
 */
const GRAPH_INKS = ["var(--accent)", "var(--ok)", "var(--warn)", "var(--muted)"];

function inkFor(column) {
  return GRAPH_INKS[column % GRAPH_INKS.length];
}

/**
 * Open the branch window on whatever is in front.
 *
 * Branches is a menu row rather than a mark, so it has no mark to take a repository from
 * and uses the window somebody was last in. When that window is not in a checkout it says
 * so and says what to do about it, rather than opening empty — a window with nothing in it
 * teaches nobody why.
 */
function openBranches() {
  const root = repoFor(state.surface);
  state.branches = {
    root,
    loading: Boolean(root),
    commits: [],
    branches: [],
    capped: false,
    trouble: root ? null : "Nothing in front is in a git repository.",
  };
  state.open = null;
  state.work.open = false;
  reachTheKeyboard();
  render();
  if (root) void readRepo(root);
}

function closeBranches() {
  state.branches = null;
  render();
}

/** Ask for both halves at once: they are drawn together and one without the other is half a window. */
async function readRepo(root) {
  try {
    const [graph, branches] = await Promise.all([
      invoke("colai_git_read", { root, what: "graph" }),
      invoke("colai_git_read", { root, what: "branches" }),
    ]);
    if (!state.branches || state.branches.root !== root) return;
    state.branches.commits = (graph && graph.commits) || [];
    state.branches.capped = Boolean(graph && graph.capped);
    state.branches.branches = (branches && branches.branches) || [];
    state.branches.trouble = null;
  } catch (trouble) {
    if (!state.branches || state.branches.root !== root) return;
    state.branches.trouble = String(trouble || "Could not read that repository.");
  } finally {
    if (state.branches && state.branches.root === root) state.branches.loading = false;
    render();
  }
}

/** Hand a branch to the agent rather than switching to it here. */
function askAbout(said) {
  state.text = said;
  closeBranches();
  openWork();
}

function drawBranches() {
  const open = state.branches !== null;
  el.branches.hidden = !open;
  if (!open) return;
  const held = state.branches;

  const head = document.createElement("div");
  head.className = "library-head";
  // The Work panel's stacked head rather than the menu's section label: `.agents-title`
  // uppercases what is inside it, which is right for "AGENTS" and wrong for a path — an
  // uppercased path is not the path, and this window's whole job is to name a real one.
  const title = document.createElement("div");
  title.className = "work-title branches-title";
  const name = document.createElement("p");
  name.className = "work-name";
  name.textContent = "Branches";
  const where = document.createElement("p");
  where.className = "work-count";
  // The repository, named. Two checkouts of one project look identical in a graph.
  where.textContent = held.root || "nowhere";
  where.title = held.root || "";
  title.append(name, where);
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "popup-shut";
  shut.textContent = "×";
  shut.title = "Close";
  shut.addEventListener("click", closeBranches);
  head.append(title, shut);

  const body = document.createElement("div");
  body.className = "branches-body scrolls";

  if (held.trouble) {
    const said = document.createElement("p");
    said.className = "menu-empty";
    said.textContent = held.trouble;
    body.append(said);
  } else if (held.loading) {
    const said = document.createElement("p");
    said.className = "menu-empty";
    said.textContent = "Reading…";
    body.append(said);
  } else {
    body.append(branchChips(held), graphOf(held));
  }

  const rows = [head, body];
  if (held.capped) {
    const said = document.createElement("p");
    said.className = "branches-capped";
    // Said rather than left to be inferred from where the list stops: a graph that ends
    // mid-history looks exactly like a repository that began there.
    said.textContent = `The newest ${held.commits.length} commits. There are more.`;
    rows.push(said);
  }
  el.branches.replaceChildren(...rows);
}

/** The branches themselves, as chips that say how far they have drifted. */
function branchChips(held) {
  const row = document.createElement("div");
  row.className = "branch-chips";
  const local = held.branches.filter((one) => !one.remote);
  for (const branch of local) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "branch-chip";
    chip.dataset.on = String(branch.head);
    const named = document.createElement("span");
    named.textContent = branch.name;
    chip.append(named);
    // How far from what it tracks, which is the question somebody opens this to answer.
    const drift = [];
    if (branch.ahead) drift.push(`↑${branch.ahead}`);
    if (branch.behind) drift.push(`↓${branch.behind}`);
    if (drift.length) {
      const said = document.createElement("span");
      said.className = "branch-drift";
      said.textContent = drift.join(" ");
      chip.append(said);
    }
    chip.title = branch.head
      ? `On ${branch.name}${branch.upstream ? ` · tracking ${branch.upstream}` : ""}`
      : `Check out ${branch.name}`;
    chip.disabled = branch.head;
    chip.addEventListener("click", () => {
      askAbout(`Check out the branch ${branch.name} in ${held.root}.`);
    });
    row.append(chip);
  }
  const fresh = document.createElement("button");
  fresh.type = "button";
  fresh.className = "branch-chip branch-new";
  fresh.textContent = "New branch…";
  fresh.title = "Start a branch here";
  fresh.addEventListener("click", () => {
    askAbout(`Start a new branch in ${held.root} from where HEAD is now, and say what you called it.`);
  });
  row.append(fresh);
  return row;
}

/** The graph: one SVG column of lines and nodes, and a row of words beside each. */
function graphOf(held) {
  const list = document.createElement("div");
  list.className = "graph";
  const rows = lanesOf(held.commits);
  const wide = lanesWide(rows);
  const width = GRAPH_EDGE * 2 + Math.max(0, wide - 1) * GRAPH_LANE;
  const now = Date.now();

  const ink = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ink.setAttribute("class", "graph-ink");
  ink.setAttribute("width", String(width));
  ink.setAttribute("height", String(rows.length * GRAPH_ROW));
  ink.setAttribute("aria-hidden", "true");
  const x = (column) => GRAPH_EDGE + column * GRAPH_LANE;

  rows.forEach((row, at) => {
    const top = at * GRAPH_ROW;
    const middle = top + GRAPH_ROW / 2;
    const bottom = top + GRAPH_ROW;
    const line = (d, column) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", inkFor(column));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-width", "1.5");
      ink.append(path);
    };
    // Lines passing behind this row, so a branch does not vanish across a commit it had
    // nothing to do with.
    for (const column of row.through) line(`M${x(column)} ${top}V${bottom}`, column);
    // The line arriving from a child above.
    if (row.up) line(`M${x(row.column)} ${top}V${middle}`, row.column);
    // And the ones leaving toward each parent, bending where the column changes.
    for (const parent of row.parents) {
      if (parent.column === row.column) {
        line(`M${x(row.column)} ${middle}V${bottom}`, row.column);
      } else {
        const from = x(row.column);
        const to = x(parent.column);
        line(`M${from} ${middle}C${from} ${bottom - 6} ${to} ${middle + 6} ${to} ${bottom}`, parent.column);
      }
    }
    const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    node.setAttribute("cx", String(x(row.column)));
    node.setAttribute("cy", String(middle));
    node.setAttribute("r", "3.4");
    node.setAttribute("fill", inkFor(row.column));
    ink.append(node);
  });

  const words = document.createElement("div");
  words.className = "graph-words";
  held.commits.forEach((commit) => {
    const line = document.createElement("div");
    line.className = "graph-row";
    // Where HEAD is, which is the one thing somebody looks for first.
    line.dataset.head = String(commit.refs.some((name) => name.startsWith("HEAD")));
    for (const named of commit.refs) {
      const chip = document.createElement("span");
      chip.className = "graph-ref";
      chip.textContent = named.replace(/^HEAD -> /, "");
      chip.dataset.head = String(named.startsWith("HEAD"));
      line.append(chip);
    }
    const hash = document.createElement("span");
    hash.className = "graph-hash";
    hash.textContent = commit.hash.slice(0, 7);
    const said = document.createElement("span");
    said.className = "graph-said";
    said.textContent = commit.subject;
    said.title = `${commit.subject}\n${commit.who}`;
    const when = document.createElement("span");
    when.className = "graph-when";
    when.textContent = briefly(commit.at, now);
    when.title = agoSaid(commit.at, now);
    line.append(hash, said, when);
    words.append(line);
  });

  list.append(ink, words);
  return list;
}
