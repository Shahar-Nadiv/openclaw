// The rail: the keys, the menus that hang off them, and who a mark can be sent to.
//
// Everything a person points at directly. The rail is the toolbar's whole face, so it
// lives apart from the layers it draws over — what a key does when it is pressed is a
// different question from what a mark looks like once it is made.
//
// The receiver list is here too, because on this surface it is part of the rail: the
// agents key is a control on it, and the menu it opens is what makes the rest of this
// mean anything. Sending is elsewhere; choosing is here.

const GLYPHS = {
  pointer: '<path d="M5 3.5l14.5 7.2-6.3 1.6-2.3 6.1z"/><path d="M12.4 12.3l5.6 5.7"/>',
  pointAt:
    '<path d="M12 21s-6-5.6-6-10.4a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2" fill="currentColor" stroke="none"/>',
  draw: '<path d="M3 20.5c3-6 6-8 8.5-8 2 0 2 2.5 0 3.5-2.5 1.2-1.5 4 1 3 4-1.5 5-6 8.5-10.5"/><circle cx="21" cy="8.5" r="1.8" fill="currentColor" stroke="none"/>',
  shape: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  design:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  undo: '<path d="M3.5 7v6h6"/><path d="M20.5 17a8.5 8.5 0 0 0-14.3-6.2L3.5 13"/>',
  redo: '<path d="M20.5 7v6h-6"/><path d="M3.5 17a8.5 8.5 0 0 1 14.3-6.2L20.5 13"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  wireframe:
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M7 8h10M7 12h6M7 16h8"/>',
  screenshot:
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8z"/>',
  measure: '<path d="M4 6v12M20 6v12M4 12h16"/><path d="M8.5 9l-3 3 3 3M15.5 9l3 3-3 3"/>',
  record:
    '<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M16.5 10.2l5-2.7v9l-5-2.7z"/>',
  compare:
    '<rect x="2.5" y="5.5" width="8" height="13" rx="1.5"/><rect x="13.5" y="5.5" width="8" height="13" rx="1.5" stroke-dasharray="2.6 2.2"/>',
  inspect:
    '<path d="M3 3.5h7M3 3.5v7M21 3.5h-7M21 3.5v7M3 20.5h7M3 20.5v-7M21 20.5h-7M21 20.5v-7"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  colour:
    '<path d="M12 3.5s6 6.4 6 10.1a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/><path d="M8.6 14.4a3.4 3.4 0 0 0 3.4 3.2"/>',
  watch:
    '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

function icon(name, size) {
  return `<svg width="${size || 17}" height="${size || 17}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

/**
 * OpenClaw's own mark, for the key that opens OpenClaw.
 *
 * Not one of the glyphs above and deliberately not drawn like one: those are line
 * drawings of what a tool does, and this is a logo. It is the tray icon's geometry
 * exactly — `src-tauri/icons/tray-template.svg` — so the critter in the rail and the
 * critter in the system tray are the same face rather than two drawings of one.
 *
 * A silhouette with the eyes punched out, filled with `currentColor`, so it dims and
 * lights with every other key on the rail.
 */
function openclawMark(size) {
  const edge = size || 17;
  return `<svg width="${edge}" height="${edge}" viewBox="0 0 18 18" aria-hidden="true">
    <mask id="colai-critter" maskUnits="userSpaceOnUse" x="0" y="0" width="18" height="18">
      <g fill="#fff">
        <g fill="none" stroke="#fff" stroke-width="2.07" stroke-linecap="round">
          <path d="M6.926 4.563 Q6.149 1.35 3.816 1.62" />
          <path d="M11.074 4.563 Q11.851 1.35 14.184 1.62" />
        </g>
        <rect x="5.4" y="12.96" width="2.52" height="3.24" rx="1.26" />
        <rect x="10.08" y="12.96" width="2.52" height="3.24" rx="1.26" />
        <circle cx="2.7" cy="9.59" r="1.8" />
        <circle cx="15.3" cy="9.59" r="1.8" />
        <ellipse cx="9" cy="8.64" rx="6.48" ry="5.94" />
      </g>
      <g fill="#000">
        <ellipse cx="6.149" cy="7.69" rx="1.426" ry="1.544" />
        <ellipse cx="11.851" cy="7.69" rx="1.426" ry="1.544" />
      </g>
      <g fill="#fff">
        <circle cx="5.522" cy="7.134" r="0.741" />
        <circle cx="11.224" cy="7.134" r="0.741" />
      </g>
    </mask>
    <rect width="18" height="18" fill="currentColor" mask="url(#colai-critter)" />
  </svg>`;
}

/* ── the rail ───────────────────────────────────────────────────────────── */

const buttons = {};

function key(id, title, glyph, onClick, caret) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML =
    icon(glyph) +
    // Only the keys that count something get somewhere to put it; the rest would carry
    // an empty span for the life of the rail.
    (id === "watch" ? '<span class="watch-many"></span>' : "") +
    (caret ? '<span class="caret">▾</span>' : "");
  button.addEventListener("click", onClick);
  buttons[id] = button;
  return button;
}

function buildRail() {
  const dividers = el.rail.querySelectorAll("[data-divider]");
  const tools = document.createDocumentFragment();
  tools.append(
    key("pointer", "Pointer · V", "pointer", () => use("pointer")),
    key("pointAt", "Point at · P", "pointAt", () => use("pointAt")),
    key("draw", "Draw · D", "draw", () => use("draw")),
    key("shape", "Box / circle · S", "shape", () => flyout("shape"), true),
    key("design", "Design", "design", () => flyout("design"), true),
  );
  dividers[0].after(tools);

  const edits = document.createDocumentFragment();
  edits.append(
    key("undo", "Undo · ⌘Z", "undo", undo),
    key("redo", "Redo · ⇧⌘Z", "redo", redo),
  );
  dividers[1].after(edits);

  const exact = document.createDocumentFragment();
  exact.append(
    key("measure", "Measure · M", "measure", () => use("measure")),
    key("colour", "Colour · C", "colour", () => use("colour")),
    key("record", "Record · R · right-click for how long", "record", () => use("record")),
    key("compare", "Before and after · A", "compare", () => compareStep()),
    key("watch", "Watch for a change · W", "watch", () => use("watch")),
    key("inspect", "Inspect what is there · I", "inspect", () => use("inspect")),
  );
  // How long it records is a setting on the tool, so it lives on the tool: a right
  // click, where a right click already means "about this", rather than another key on
  // a rail that has enough of them.
  buttons.record.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    flyout("record");
  });

  dividers[1].after(exact);

  const agents = document.createElement("button");
  agents.type = "button";
  agents.className = "key agents-key";
  agents.title = "Agents";
  agents.innerHTML =
    '<span class="running-dots"></span><span class="agents-name"><span class="agents-who"></span><span class="agents-running"></span></span><span class="caret">▾</span>';
  agents.addEventListener("click", () => flyout("agents"));
  buttons.agents = agents;

  const send = document.createElement("button");
  send.type = "button";
  send.className = "key send-key";
  send.title = "Send what you marked";
  send.innerHTML =
    icon("send") + '<span class="send-many"></span><span class="caret">▾</span>';
  send.addEventListener("click", () => flyout("send"));
  buttons.send = send;

  // The way back to OpenClaw itself, wearing OpenClaw's own face. A gear said
  // "preferences"; what this opens is the application.
  const home = document.createElement("button");
  home.type = "button";
  home.className = "key home-key";
  home.title = "OpenClaw · ⌘,";
  home.setAttribute("aria-label", "Open OpenClaw");
  home.innerHTML = openclawMark();
  home.addEventListener("click", () => invoke("colai_open_settings"));
  buttons.settings = home;

  dividers[2].after(send, agents, home);

  row(el.flyShape, "box", "Box", "box", "B");
  row(el.flyShape, "circle", "Circle", "circle", "O");
  row(el.flyDesign, "design", "Design", "wireframe");
  row(el.flyDesign, "screenshot", "Screenshot", "screenshot");
  for (const seconds of RECORD_LENGTHS) length(el.flyRecord, seconds);
}

/** One of the lengths a recording can be, on the menu the record key opens. */
function length(into, seconds) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.dataset.seconds = String(seconds);
  button.innerHTML = icon("record", 14) + `<span>${seconds} seconds</span>`;
  button.addEventListener("click", () => {
    state.recordFor = seconds;
    // Chosen from the record menu, so the choice is also the tool: nobody opens this to
    // set a number and then goes looking for the key they just right-clicked.
    use("record");
  });
  into.append(button);
}

function row(into, tool, label, glyph, press) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.dataset.tool = tool;
  button.innerHTML =
    icon(glyph, 14) +
    `<span>${label}</span>` +
    (press ? `<span class="row-key">${press}</span>` : "");
  button.addEventListener("click", () => use(tool));
  into.append(button);
}

/* ── using a tool, and the one decision that matters ─────────────────────── */

/**
 * A tool that only marks always works — reading is universal. A tool that changes
 * something is refused unless a connector owns the surface, and refused *here*, before
 * anything is dispatched, so there is no path where a write is attempted and then
 * apologised for.
 */
function use(tool) {
  state.tool = tool;
  state.open = null;
  render();
}

/**
 * The agent or session currently marked as receiving, whichever it is.
 *
 * Returned as one shape so everything downstream — the rail's label, the popup, the
 * mark beside a row — can name the receiver without first asking which kind it is.
 */
function receiver() {
  if (state.receiving.id === null) return null;
  if (state.receiving.kind === "thread") {
    const thread = everyThread().find((row) => row.id === state.receiving.id);
    if (thread) return { name: thread.title, emoji: null };
  } else if (state.receiving.kind === "session") {
    const session = state.sessions.find((row) => row.key === state.receiving.id);
    if (session) return { name: session.title, emoji: emojiFor(session) };
  } else {
    const agent = state.agents.find((row) => row.id === state.receiving.id);
    if (agent) return { name: agent.name, emoji: agent.emoji };
  }
  // Off the list rather than gone. The remembered name is what was true when it was
  // picked, which is a better answer than pretending nobody is receiving.
  return state.receiving.name ? { name: state.receiving.name, emoji: state.receiving.emoji } : null;
}

/**
 * How many conversations there are to hand something to.
 *
 * Gateway sessions and threads held elsewhere counted as one number, because that is
 * how somebody counts them: they are all conversations, and which process is holding
 * one is the sort of distinction a rail with room for four words should not spend.
 */
function talking() {
  return state.sessions.length + everyThread().length;
}

/** Every conversation held elsewhere, folders flattened away. */
function everyThread() {
  return state.projects.flatMap((project) => project.threads);
}

/**
 * Which folders are open, counting the ones that have no choice about it.
 *
 * A folder holding the conversation currently receiving stays open, because a menu that
 * hides the row it is describing is a menu you cannot check. And a lone folder is opened
 * too: one collapsed row is a list of nothing.
 */
function openedProjects() {
  const open = new Set(state.opened);
  if (state.projects.length === 1) open.add(state.projects[0].key);
  if (state.receiving.kind === "thread") {
    const holding = state.projects.find((project) =>
      project.threads.some((thread) => thread.id === state.receiving.id),
    );
    if (holding) open.add(holding.key);
  }
  return open;
}

function toggleProject(key) {
  if (state.opened.has(key)) state.opened.delete(key);
  else state.opened.add(key);
  render();
}

/** A session wears its agent's face, so the two lists read as one set of people. */
function emojiFor(session) {
  const agent = state.agents.find((row) => row.id === session.agentId);
  return agent ? agent.emoji : null;
}

function flyout(which) {
  state.open = state.open === which ? null : which;
  render();
  // Asked when the menu opens rather than polled: the answer only matters when somebody
  // is looking at it, and a conversation's title and status move while it runs, so a
  // list kept warm in the background would be a list that is quietly wrong.
  // Both menus show who could receive, and both are worth a fresh look at what is in
  // front: the answer is different by the time somebody opens one.
  if (state.open === "agents" || state.open === "send") void learnFront().then(loadWho);
}

/**
 * Who this machine can hand a region to: its agents, and the conversations underway.
 *
 * The application's own lists, not a second idea of them — the toolbar should never
 * disagree with the window behind it about what is running. A failure leaves them alone
 * and says so on the rail rather than emptying them, because "nobody there" and "could
 * not ask" are different facts and only one of them is the user's problem.
 */
async function loadWho() {
  const pick = (kind) => (state.receiving.kind === kind ? state.receiving.id : null);
  try {
    // Asked together, because the menu shows them together: two answers a second apart
    // would let the rail claim a receiver that the list below it does not offer.
    const [agents, sessions, projects] = await Promise.all([
      invoke("colai_agents", { receiving: pick("agent") }),
      invoke("colai_sessions", { receiving: pick("session") }),
      invoke("colai_threads", { receiving: pick("thread") }),
    ]);
    state.agents = agents || [];
    state.sessions = sessions || [];
    state.projects = projects || [];
    // The conversation about whatever is on the screen in front, when it is obvious
    // which that is. Telling the toolbar what it can already see was the most repeated
    // act in using it.
    // Nobody picked yet, so the Gateway's own default stands in — the first thing
    // somebody marks still has somewhere to go.
    if (state.receiving.id === null) {
      const fallback = state.agents.find((agent) => agent.receiving);
      if (fallback) {
        state.receiving = {
          kind: "agent",
          id: fallback.id,
          name: fallback.name,
          emoji: fallback.emoji,
          locator: null,
        };
      }
    }
    state.whoTrouble = null;
  } catch (error) {
    state.whoTrouble = error && error.message ? error.message : String(error);
  }
  render();
}

function receive(kind, id, name, emoji, locator) {
  state.picked = true;
  // The locator travels with the choice. A conversation held elsewhere is addressed by
  // its catalog, host and thread together, and by the time somebody sends, the list it
  // came from may have been reloaded out from under the id.
  state.receiving = { kind, id, name, emoji: emoji || null, locator: locator || null };
  state.open = null;
  void loadWho();
}

function undo() {
  const last = state.marks.pop();
  if (!last) return;
  state.undone.push(last);
  render();
}

function redo() {
  const back = state.undone.pop();
  if (!back) return;
  state.marks.push(back);
  render();
}

function placeFlyout(node, vertical, from) {
  node.style.cssText = "";
  const along = vertical ? "top" : "left";
  node.style[along] = `${from}px`;
  if (vertical) {
    node.style[state.dock === "right" ? "right" : "left"] = "calc(100% + 10px)";
  } else {
    node.style[state.dock === "top" ? "top" : "bottom"] = "calc(100% + 8px)";
  }
  if (node.hidden) return;
  // Measured only once it is placed and filled: a menu's length depends on how many
  // conversations are in it, which is not known until it is drawn.
  const fitted = within(node, vertical ? "y" : "x", from);
  if (fitted !== from) node.style[along] = `${fitted}px`;
}

/**
 * Where a flyout has to sit to stay on the screen.
 *
 * Menus open at a fixed offset from the top of the rail, which is fine in the middle of
 * a screen and wrong at the end of one: a rail docked low with a full list of
 * conversations opened it straight off the bottom, and the rows nearest the bottom were
 * simply unreachable. Nudged back by however much it overhangs, and the near edge wins
 * when a menu is too long to fit either way — the top of a list is where reading starts.
 */
function within(node, axis, at) {
  const box = node.getBoundingClientRect();
  const room = usable(screenAt(state.screens, { x: box.left, y: box.top }));
  const near = axis === "y" ? room.top + EDGE : room.left + EDGE;
  const far = axis === "y" ? room.bottom - EDGE : room.right - EDGE;
  const head = axis === "y" ? box.top : box.left;
  const tail = axis === "y" ? box.bottom : box.right;
  let shift = Math.min(0, far - tail);
  if (head + shift < near) shift = near - head;
  return Math.round(at + shift);
}
