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
  arrow: '<path d="M4.5 19.5L19 5"/><path d="M11.5 5H19v7.5"/>',
  line: '<path d="M4.5 19.5L19.5 4.5"/>',
  highlight:
    '<path d="M4 20.5h16" stroke-width="3.4" opacity="0.45"/><path d="M8.5 15.5l6.6-9.6 3.6 2.6-6.6 9.6z"/><path d="M8.5 15.5l3.6 2.6"/>',
  shape: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  design:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  undo: '<path d="M3.5 7v6h6"/><path d="M20.5 17a8.5 8.5 0 0 0-14.3-6.2L3.5 13"/>',
  redo: '<path d="M20.5 7v6h-6"/><path d="M3.5 17a8.5 8.5 0 0 1 14.3-6.2L20.5 13"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  wireframe:
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M7 8h10M7 12h6M7 16h8"/>',
  redline:
    '<rect x="3" y="7.5" width="18" height="13" rx="2"/><path d="M3 3.5h18M4.5 2v3M19.5 2v3"/>',
  component:
    '<rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.6"/><rect x="13" y="13" width="8.5" height="8.5" rx="1.6"/><path d="M11 6.75h4.25a2 2 0 0 1 2 2V13"/>',
  system:
    '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  tokens:
    '<path d="M3 11.6V4.6A1.6 1.6 0 0 1 4.6 3h7L21 12.4 12.4 21z"/><circle cx="7.6" cy="7.6" r="1.5" fill="currentColor" stroke="none"/>',
  screenshot:
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  measure: '<path d="M4 6v12M20 6v12M4 12h16"/><path d="M8.5 9l-3 3 3 3M15.5 9l3 3-3 3"/>',
  record:
    '<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M16.5 10.2l5-2.7v9l-5-2.7z"/>',
  colour:
    '<path d="M12 3.5s6 6.4 6 10.1a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/><path d="M8.6 14.4a3.4 3.4 0 0 0 3.4 3.2"/>',
  more:
    '<circle cx="6" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="18" r="1.7" fill="currentColor" stroke="none"/>',
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

/**
 * One mark, one meaning: a caret says this key opens a menu.
 *
 * Every key with something behind it wears it and behaves the same way — press it, a
 * list opens, pick from the list. Box and circle work that way, so do the kinds of
 * design, and so do the pens and the recording lengths. A second idiom for the same
 * idea is a second thing to learn for no gain, and the one that was tried here — a
 * corner wedge meaning "right-click me" — was a menu people had to be told about.
 */
const MENU = "caret";

function key(id, title, glyph, onClick, mark) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML =
    icon(glyph) +
    (mark === MENU ? '<span class="caret">▾</span>' : "");
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
    key("draw", "Draw · D", "draw", () => flyout("draw"), MENU),
    key("shape", "Box / circle · S", "shape", () => flyout("shape"), MENU),
    key("design", "Design", "design", () => flyout("design"), MENU),
  );
  dividers[0].after(tools);

  const edits = document.createDocumentFragment();
  edits.append(
    key("undo", "Undo · ⌘Z", "undo", undo),
    key("redo", "Redo · ⇧⌘Z", "redo", redo),
  );
  dividers[1].after(edits);

  // The exact tools, and the key that folds them out of the way.
  //
  // Folding happens on the rail itself: the six close up where they stand and the rail
  // gets shorter, rather than moving into a menu. A menu would be a second place to go
  // looking for a tool, and the whole reason to fold anything is that a rail is easier
  // to read when it is shorter — not that somewhere else is a better home for them.
  const exact = document.createDocumentFragment();
  exact.append(
    key("exact", "Measure, colour, record…", "more", toggleTucked, MENU),
    key("measure", "Measure · M", "measure", () => use("measure")),
    key("colour", "Colour · C", "colour", () => use("colour")),
    key("record", "Record · R", "record", () => flyout("record"), MENU),
  );
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
  // Sending is what this key does; scheduling the same thing is what it is about. A
  // right click, the same as the record key's length — "more about this key" rather
  // than another key.
  send.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    // Fresh every time. An automation is about one piece of work, and a half-filled
    // schedule left over from the last one is a job somebody creates by accident.
    if (state.open !== "automate") state.cron = { ...AUTOMATION_FIRST };
    flyout("automate");
  });
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

  // Only ever on the rail while something is running, and beside the key that says so.
  // Stopping is the one thing here that destroys work rather than describing it, so it
  // is never a key somebody can press by reflex looking for something else.
  const stop = key("stop", "Stop the agent", "stop", () => void stopEverything());
  stop.classList.add("stop-key");
  stop.hidden = true;

  dividers[2].after(send, agents, stop, home);

  row(el.flyShape, "box", "Box", "box", "B");
  row(el.flyShape, "circle", "Circle", "circle", "O");
  // Every kind of design on the menu, not one row called "Design" with the choice
  // hidden in the popup that opens afterwards. What somebody is after — a wireframe, a
  // redline, a whole design system — is the thing they came to this key for, and a menu
  // that does not name it is a menu they conclude cannot do it.
  for (const [id, kind] of Object.entries(DESIGNS)) {
    designRow(el.flyDesign, id, kind);
  }
  const between = document.createElement("span");
  between.className = "row-divider";
  el.flyDesign.append(between);
  row(el.flyDesign, "screenshot", "Screenshot", "screenshot");
  for (const seconds of RECORD_LENGTHS) length(el.flyRecord, seconds);
  for (const [id, pen] of Object.entries(PENS)) penRow(el.flyDraw, id, pen);
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

/** The tools that fold away together, in the order they sit on the rail. */
const EXACT = ["measure", "colour", "record"];

/** Fold them shut, or open them out, and remember which. */
function toggleTucked() {
  state.tucked = !state.tucked;
  state.open = null;
  remember();
  render();
  followTheFold();
}

/**
 * Keep the clickable region on the rail while the rail is still changing size.
 *
 * The shape is measured from the drawn rectangle, and for the fifth of a second the
 * keys are opening or closing the drawn rectangle is a different size every frame.
 * Measured once at the start, the toolbar spends that fifth of a second answering the
 * pointer where it used to be — which is silent, and indistinguishable from a dead
 * button.
 */
let following = 0;
function followTheFold() {
  cancelAnimationFrame(following);
  // A few frames past the end: six keys finish six transitions at slightly different
  // moments, and the last one is not reliably the one that settles the width.
  const until = Date.now() + FOLD_TIME + 60;
  const again = () => {
    clamp();
    if (Date.now() < until) following = requestAnimationFrame(again);
  };
  again();
}

/**
 * Stop what is running.
 *
 * Everything, because the key beside the count is about the count. Stopping one
 * particular run is a thing to do from the list where that run has a name, not from a
 * button that does not know which one somebody meant.
 */
async function stopEverything() {
  const runs = state.runs;
  if (runs.length === 0) return;
  state.runs = [];
  render();
  const stopped = [];
  for (const run of runs) {
    try {
      await invoke("colai_stop", { sessionKey: run.sessionKey });
      stopped.push(run.who || run.sessionKey);
    } catch (error) {
      state.trouble = `Could not stop ${run.who || "that run"} — ${error && error.message ? error.message : String(error)}`;
    }
  }
  // Said, not assumed. A stop that produced no answer looks exactly like a stop that did
  // not happen, and somebody who pressed it needs to know which.
  if (stopped.length) state.trouble = `Stopped ${stopped.join(", ")}.`;
  render();
}

/** One pen on the menu the drawing key opens. */
function penRow(into, id, pen) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.dataset.pen = id;
  button.innerHTML = icon(pen.glyph, 14) + `<span>${pen.label}</span>`;
  button.addEventListener("click", () => {
    state.pen = id;
    // Picking a pen is also picking the tool. Nobody opens this to set a pen and then
    // goes looking for the key they just right-clicked.
    use("draw");
  });
  into.append(button);
}

/**
 * One kind of design on the menu.
 *
 * Picking it settles what the next mark will ask for and puts the tool in your hand in
 * the same click. The kind can still be changed in the popup afterwards — that is where
 * somebody who marked first and decided later goes — but nobody should have to mark
 * something to find out whether this toolbar can build them a design system.
 */
function designRow(into, id, kind) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.dataset.tool = "design";
  button.dataset.design = id;
  button.innerHTML = icon(kind.glyph, 14) + `<span>${kind.label}</span>`;
  button.addEventListener("click", () => {
    state.designKind = id;
    use("design");
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
    const [agents, sessions, projects, allowed] = await Promise.all([
      invoke("colai_agents", { receiving: pick("agent") }),
      invoke("colai_sessions", { receiving: pick("session") }),
      invoke("colai_threads", { receiving: pick("thread") }),
      // What this connection may do, asked with the rest rather than once at startup.
      // The Gateway connects a moment after the app does — which is why the ask below
      // is retried — so a single question at load is answered before there is anything
      // to answer it, and a menu would spend the session saying it was not allowed.
      invoke("colai_allowed"),
    ]);
    state.allowed = allowed || [];
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
