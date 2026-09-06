// The toolbar: point at anything on screen and hand it to an agent.
//
// The decisions live in toolbar-tools.js, which knows nothing about a browser. This is
// the page: the rail, the gestures, and what gets drawn.

/* ── browser bindings ─────────────────────────────────────────────────────── */

const tauri = window["__TAURI__"];
const invoke = tauri ? tauri.core.invoke : async () => undefined;
const listen = tauri ? tauri.event.listen : async () => () => {};

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

const WHERE = "openclaw.toolbar.where";

const el = {
  wrap: document.getElementById("rail-wrap"),
  rail: document.getElementById("rail"),
  grip: document.getElementById("grip"),
  flyShape: document.getElementById("fly-shape"),
  flyDesign: document.getElementById("fly-design"),
  flyRecord: document.getElementById("fly-record"),
  flyAgents: document.getElementById("fly-agents"),
  agentRows: document.getElementById("agent-rows"),
  trouble: document.getElementById("trouble"),
  marks: document.getElementById("marks"),
  pins: document.getElementById("pins"),
  watching: document.getElementById("watching"),
  recording: document.getElementById("recording"),
  recordingArea: document.getElementById("recording-area"),
  recordingLeft: document.getElementById("recording-left"),
  capture: document.getElementById("capture"),
  popup: document.getElementById("popup"),
  answers: document.getElementById("answers"),
  flySend: document.getElementById("fly-send"),
};

const state = {
  tool: "pointer",
  dock: null,
  at: null,
  open: null,
  surface: null,
  // Every display, each with what its own desktop keeps of it. The overlay covers the
  // whole desk, so which screen a thing is on is a question that now has to be asked.
  screens: [],
  agents: [],
  sessions: [],
  // Conversations held elsewhere, already grouped by the folder they belong to.
  projects: [],
  // Which of those folders are open. A menu of two dozen threads is unreadable flat,
  // and a menu of only folders shows nothing, so what is open is the thing being
  // remembered rather than a default applied to everybody.
  opened: new Set(),
  // Null while the lists are good, a message while the Gateway could not be asked. The
  // two are different facts and the rail says which.
  whoTrouble: null,
  // Who gets what you point at. An agent is somebody who could answer; a session is a
  // conversation already underway. Which of the two it is has to be carried, because
  // the same name can belong to both and a send has to know which it is addressing.
  //
  // The name is kept beside the id on purpose. The menu shows recent conversations, so
  // a session picked an hour ago can fall off it; forgetting who was receiving because
  // they scrolled out of a menu would be the toolbar losing your choice for you.
  receiving: { kind: "agent", id: null, name: null, emoji: null },
  marks: [],
  undone: [],
  // The mark whose popup is open, if any. One at a time: two dialogs about two regions
  // is a conversation nobody can follow.
  popup: null,
  // A before-and-after that has its before and is waiting for the world to change.
  comparing: null,
  // How long a recording covers. Somebody's choice, not a constant.
  recordFor: RECORD_LENGTHS[0],
  // Files and folders somebody brought in, as paths this machine can still find them
  // by. Not their contents: they are on a disk that is better at holding them than
  // this page is, and are read at the moment they are sent.
  files: [],
  // Set while something is being dragged over the toolbar, so it can say it will
  // catch it.
  catching: false,
  // The recording underway, while it is underway: the region it covers and when it
  // ends. Null the rest of the time.
  recording: null,
  // The regions being watched. Each one is a mark that has had its "before" taken and
  // is waiting for the world to move.
  watching: [],
  // Whether the receiver was chosen rather than worked out. A guess may fill an empty
  // seat; it may never take one somebody has sat in.
  picked: false,
  // The project the window in front belongs to, when that is obvious.
  inFront: null,
  // What the next send is for, and anything else somebody wants to say with it.
  mode: "plan",
  text: "",
  // Conversations held elsewhere that have already been agreed to. Continuing one hands
  // it to the Gateway, which is a real change of ownership, so it is asked once and then
  // remembered rather than asked on every send.
  adopted: [],
  // Set while a send is in the air, so a second click cannot post it twice.
  sending: false,
  // What went wrong, when something did. Null the rest of the time, which is the rest
  // of the time.
  trouble: null,
  // What has been sent and is still owed an answer, and the answers that have arrived.
  // Kept after the marks themselves are gone, because the point of an answer is that it
  // comes back to the place the question was asked about.
  answers: [],
};

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
  row(el.flyDesign, "wireframe", "Create wireframe", "wireframe");
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

/* ── drawing ─────────────────────────────────────────────────────────────── */

let gesture = null;
let liveFrame = 0;

function fractionOf(event) {
  const box = el.capture.getBoundingClientRect();
  if (!box.width || !box.height) return { x: 0, y: 0 };
  const clamp = (value) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((event.clientX - box.left) / box.width),
    y: clamp((event.clientY - box.top) / box.height),
  };
}

el.capture.addEventListener("pointerdown", (event) => {
  // Only the primary button. A right-click over somebody's desktop belongs to whatever
  // is underneath, and swallowing it is how an overlay earns a reputation.
  if (event.button !== 0) return;
  event.preventDefault();
  // Anywhere off the popup is the third way out of it. The catcher covers the whole
  // desk and the popup is stacked above it, so this only ever fires outside.
  if (state.popup !== null) {
    cancelMark(state.popup);
    return;
  }
  if (event.target.setPointerCapture) event.target.setPointerCapture(event.pointerId);

  const point = fractionOf(event);
  const kind = DRAWS[state.tool];

  // A pin is the click itself; there is nothing to drag out, and waiting for the
  // release would make a tool that should feel instant feel unsure.
  if (!kind) {
    addMark({ tool: state.tool, region: null, points: [point] });
    return;
  }
  gesture = { kind, points: [point] };
  drawLive();
});

el.capture.addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const point = fractionOf(event);
  if (gesture.kind === "stroke") {
    // A 120Hz pointer emits points a fraction of a pixel apart; keeping them all makes
    // a path attribute nothing can read and every frame has to re-parse.
    const last = gesture.points[gesture.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return;
    gesture.points.push(point);
    return;
  }
  gesture.points[1] = point;
});

function release() {
  const finished = gesture;
  gesture = null;
  cancelAnimationFrame(liveFrame);
  const live = document.getElementById("live");
  if (live) live.remove();
  const liveSpan = document.getElementById("live-span");
  if (liveSpan) liveSpan.remove();
  if (!finished || finished.points.length === 0) return;

  const box = boxOf(finished.points);
  // A press that went nowhere is a click, not a region. Without this every stray click
  // becomes a zero-sized mark that is invisible, un-hittable, and still counted.
  if (finished.kind !== "stroke" && box.w < 0.004 && box.h < 0.004) {
    // Except for the two tools that photograph: not dragging one out is how somebody
    // asks for the whole screen, and refusing that as a slip would leave the simplest
    // thing the toolbar does with no way to ask for it.
    if (WHOLE_DISPLAY.includes(state.tool)) {
      addMark({ tool: state.tool, region: null, points: [] });
    }
    return;
  }

  const made = {
    tool: state.tool,
    region:
      finished.kind === "stroke" || finished.kind === "span"
        ? null
        : { shape: finished.kind === "ellipse" ? "ellipse" : "box", box },
    points: finished.points,
  };
  // Settled once, here, rather than recomputed wherever it happens to be needed: the
  // rail can move to a screen of another size, and the answer is about the pixels that
  // were under the hand at the time.
  if (finished.kind === "span") made.px = spanOf(finished.points, screenNow());
  addMark(made);
}

el.capture.addEventListener("pointerup", release);
el.capture.addEventListener("pointercancel", release);

/**
 * The live shape, drawn straight into one attribute rather than through a re-render.
 *
 * A still hand produces the same path string every frame, so comparing it is far
 * cheaper than writing an attribute the browser then has to re-parse.
 */
function drawLive() {
  let previous = "";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.id = "live";
  path.setAttribute("stroke", "var(--accent, #ff6b6b)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-dasharray", "6 4");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  el.marks.append(path);

  let label = null;
  const step = () => {
    liveFrame = requestAnimationFrame(step);
    if (!gesture) return;
    const d = pathFor(gesture);
    if (d === previous) return;
    previous = d;
    path.setAttribute("d", d);
    // Measuring without seeing the number while you drag is not measuring, it is
    // guessing and then being told.
    if (gesture.kind === "span" && gesture.points.length > 1) {
      if (label) label.remove();
      label = spanLabel(gesture.points, `${spanOf(gesture.points, screenNow())}px`);
      label.id = "live-span";
      el.pins.append(label);
    }
    path.setAttribute(
      "fill",
      gesture.kind === "stroke" ? "none" : "color-mix(in srgb, var(--accent, #ff6b6b) 13%, transparent)",
    );
  };
  step();
}

function addMark(mark) {
  mark.id = `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  mark.note = "";
  // In the next send unless somebody says otherwise. Marking something and then having
  // to go and tick it is a step nobody asked for.
  mark.chosen = true;
  if (mark.tool === "wireframe") mark.dest = WIREFRAME_HOME;
  state.marks.push(mark);
  // A new mark ends the redo trail: what was undone is no longer what comes next.
  state.undone = [];
  render();
  void shoot(mark);
}

/**
 * Photograph what a mark is about, then ask what to do with it.
 *
 * The page makes itself invisible first. The overlay is transparent, so a page that
 * draws nothing composites to nothing and the picture comes out without the toolbar in
 * it — which hiding the window would also achieve, at the cost of the window manager
 * handing the keyboard somewhere else the moment it came back.
 *
 * Two frames and a moment: the compositor has to have presented the empty overlay
 * before the pixels underneath it are read, and a frame callback only says the page has
 * drawn, not that anybody has seen it.
 */
async function shoot(mark, again) {
  await photograph(mark, again);
  // A before-and-after is not finished by its first picture. It waits, visibly, for
  // whatever is about to happen to happen.
  if (mark.tool === "compare" && !again) {
    state.comparing = mark.id;
    render();
    return;
  }
  state.comparing = null;
  state.popup = mark.id;
  render();
  // The note is a text field and one way out is a key, and neither works while the
  // window manager treats this window as scenery.
  void invoke("colai_take_keyboard").catch(() => {});
}

/**
 * Take the picture, and nothing else.
 *
 * Split from `shoot` because a watch takes its second picture with nobody there. The
 * popup and the keyboard grab are what a person wants when they have just marked
 * something, and are exactly wrong when the toolbar is answering a change that happened
 * while somebody was in another window: an overlay that seizes the keyboard because a
 * build finished is an overlay that eats the sentence they were typing.
 */
async function photograph(mark, again) {
  // What is in front *now*. A mark is about the window somebody is looking at, and
  // reading that once when the app started answered a question about a different
  // afternoon.
  await learnFront();
  document.body.style.visibility = "hidden";
  try {
    await new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)));
    await new Promise((waited) => setTimeout(waited, 40));
    // Asked before the picture, while the window underneath is still the one that was
    // pointed at and nothing of ours has been drawn over it.
    if (mark.tool === "inspect") {
      mark.seen = await invoke("colai_inspect", {
        x: Math.round(mark.points[0].x * window.innerWidth),
        y: Math.round(mark.points[0].y * window.innerHeight),
      }).catch(() => null);
    }
    // A recording is the one capture long enough to be waited through, so it says so
    // while it happens — and gives the desktop back while it does, because a recording
    // of somebody being unable to click anything is not what they were pointing at.
    if (mark.tool === "record") startRecording(mark);
    const taken = await invoke("colai_capture_mark", {
      mark,
      accent: accentNow(),
      again,
      seconds: state.recordFor,
    });
    if (taken.hex) mark.hex = taken.hex;
    mark.frames = taken.frames;
    mark.seconds = taken.seconds;
    if (!again) mark.thumb = taken.thumb;
    mark.shot = `${taken.width}\u00d7${taken.height}`;
  } catch (error) {
    // The mark still exists and can still be described; it simply arrives without a
    // picture. Saying which is better than a popup that looks broken.
    mark.trouble = error && error.message ? error.message : String(error);
  } finally {
    stopRecording();
    document.body.style.visibility = "";
  }
}

/**
 * The second half of a before-and-after, or the start of one.
 *
 * The same key does both, because they are one gesture with a pause in the middle:
 * mark the thing, go and change it, press again. A separate button for the second half
 * would be a button that does nothing most of the time.
 */
function compareStep() {
  const waiting = state.marks.find((mark) => mark.id === state.comparing);
  if (!waiting) {
    use("compare");
    return;
  }
  state.comparing = null;
  void shoot(waiting, true);
}

/**
 * Which application is in front, and which project that makes this about.
 *
 * Asked again rather than remembered from startup: the window in front is the one
 * thing on this desktop guaranteed to have changed since.
 */
async function learnFront() {
  try {
    const front = await invoke("colai_frontmost");
    // No connector until the surface registry exists. Stated rather than implied: this
    // is what a write is refused on, and defaulting it otherwise would make the refusal
    // meaningless. The title comes with it, because that is where an editor puts the
    // name of the repository it has open.
    state.surface = front ? { app: front.app, title: front.title, connector: null } : null;
  } catch {
    state.surface = null;
  }
  state.inFront = projectInFront(state.projects, state.surface);
}

/** The colour the app is themed in, if it has told us one. */
function accentNow() {
  const said = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return said || undefined;
}

/* ── drawing the whole thing ─────────────────────────────────────────────── */

function render() {
  const vertical = isVertical(state.dock);
  el.wrap.dataset.vertical = String(vertical);
  el.wrap.dataset.dock = state.dock || "";
  el.wrap.dataset.catching = String(state.catching);

  for (const [id, button] of Object.entries(buttons)) {
    if (id === "shape") {
      button.setAttribute(
        "aria-pressed",
        String(state.tool === "box" || state.tool === "circle" || state.open === "shape"),
      );
    } else if (id === "design") {
      button.setAttribute(
        "aria-pressed",
        String(
          state.tool === "wireframe" || state.tool === "screenshot" || state.open === "design",
        ),
      );
    } else if (id === "agents") {
      button.setAttribute("aria-pressed", String(state.open === "agents"));
    } else if (id === "send") {
      button.setAttribute("aria-pressed", String(state.open === "send"));
    } else if (id === "compare") {
      // Lit while it is holding a "before", because a toolbar quietly waiting on you is
      // a toolbar you have forgotten about.
      button.setAttribute("aria-pressed", String(state.comparing !== null || state.tool === "compare"));
      button.title = state.comparing
        ? "Capture the after · A"
        : "Before and after · A";
    } else if (id === "watch") {
      // Pressed means "this is the tool in your hand", the same as every other key —
      // a running watch is not a held tool, and lighting it the same way made the rail
      // look like two tools were selected at once. What is running gets a count, the
      // way the send key counts what is waiting to go.
      button.setAttribute("aria-pressed", String(state.tool === "watch"));
      button.querySelector(".watch-many").textContent = state.watching.length
        ? String(state.watching.length)
        : "";
      button.dataset.live = String(state.watching.length > 0);
      button.title = state.watching.length
        ? `${counted(state.watching.length, "region")} being watched · W`
        : "Watch for a change · W";
    } else if (id === "record") {
      button.setAttribute("aria-pressed", String(state.tool === "record" || state.open === "record"));
      button.title = `Record ${state.recordFor} seconds · R · right-click for how long`;
    } else if (TOOLS[id]) {
      button.setAttribute("aria-pressed", String(state.tool === id));
    }
  }
  buttons.undo.disabled = state.marks.length === 0;
  buttons.redo.disabled = state.undone.length === 0;

  const who = receiver();
  const mark = buttons.agents.querySelector(".running-dots");
  // An initial when there is no emoji, because upright the name beside this is hidden
  // and an empty mark leaves the control saying nothing at all.
  mark.textContent = who ? who.emoji || who.name.slice(0, 1).toUpperCase() : "";
  mark.hidden = !who;
  buttons.agents.querySelector(".agents-who").textContent = who
    ? who.name
    : state.agents.length || talking()
      ? "Choose who receives"
      : "Agents";
  buttons.agents.querySelector(".agents-running").textContent = state.whoTrouble
    ? "unavailable"
    : counted(state.agents.length, "agent") +
      (talking() ? ` · ${counted(talking(), "conversation")}` : "");

  for (const button of document.querySelectorAll(".row[data-tool]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
  }

  const waiting = chosenMarks().length;
  buttons.send.querySelector(".send-many").textContent = waiting ? String(waiting) : "";
  buttons.send.dataset.waiting = String(waiting > 0);

  el.flyShape.hidden = state.open !== "shape";
  el.flyDesign.hidden = state.open !== "design";
  el.flyRecord.hidden = state.open !== "record";
  for (const button of el.flyRecord.children) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === state.recordFor));
  }
  el.flyAgents.hidden = state.open !== "agents";
  el.flySend.hidden = state.open !== "send";
  // Filled before it is placed. A menu is measured to decide whether it fits on the
  // screen, and measuring it empty answers a question about a different menu — which is
  // how a full list of conversations came to hang off the bottom of the display while
  // the same code, run again a moment later, put it back.
  if (state.open === "send") drawComposer();
  if (state.open === "agents") drawWho();
  // Under the key that opened it, measured rather than guessed. Four hand-tuned
  // offsets used to stand here, and they were four chances to drift: adding the record
  // key pushed everything to its right along and left the design menu opening under a
  // key three along from the one that owns it.
  for (const [node, anchor] of [
    [el.flyShape, buttons.shape],
    [el.flyDesign, buttons.design],
    [el.flyRecord, buttons.record],
    [el.flySend, buttons.send],
    [el.flyAgents, buttons.agents],
  ]) {
    placeFlyout(node, vertical, vertical ? anchor.offsetTop : anchor.offsetLeft);
  }

  drawMarks();
  drawWatching();
  drawAnswers();
  drawPopup();
  drawTrouble();
  // Left mounted while a popup is open, which is how a click off the popup is heard at
  // all — the popup is stacked above it, so its own controls still get their clicks.
  el.capture.hidden = state.tool === "pointer";
  shape();
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

/* ── watching a region, and saying so ────────────────────────────────────── */

/**
 * Arm a watch on a mark that has already had its "before" taken.
 *
 * Deliberate rather than automatic: dragging a box out with this tool photographs the
 * region like any other, and the popup is where somebody says what they are waiting for
 * before agreeing to be told about it. A toolbar that started watching the moment a box
 * was drawn would be one that had begun observing a screen without being asked.
 */
async function startWatching(mark) {
  // Every watch is dragged out as a region, so this is a guard rather than a case: a
  // watch with no area has nothing to look at and would sit on the rail forever.
  if (!mark.region) return;
  try {
    await invoke("colai_watch_start", { mark });
    state.watching = [
      ...state.watching.filter((held) => held.id !== mark.id),
      { id: mark.id, box: mark.region.box },
    ];
    state.popup = null;
    // And put the tool away. A watch is something you set and walk away from, and the
    // sheet of glass a marking tool holds over the desk is the opposite of walking
    // away.
    state.tool = "pointer";
    state.trouble = null;
  } catch (error) {
    state.trouble = `Could not watch that — ${error && error.message ? error.message : String(error)}`;
  }
  render();
}

/** Stop watching, and forget the marker, whoever decided it was over. */
async function stopWatching(id, alsoTellRust) {
  state.watching = state.watching.filter((held) => held.id !== id);
  if (alsoTellRust) await invoke("colai_watch_stop", { markId: id }).catch(() => {});
  render();
}

/**
 * Something the toolbar was watching moved.
 *
 * The picture is taken here rather than where the change was noticed, because taking it
 * means hiding the toolbar first — otherwise the "after" has a toolbar in it and the
 * "before" does not, and the only difference an agent can be sure of is ours.
 */
async function watchFired(id) {
  await stopWatching(id, false);
  const mark = state.marks.find((held) => held.id === id);
  // The mark can be gone: sent by hand, undone, or aged out of the store while the
  // watch ran. There is nothing to compare it against, so there is nothing to send.
  if (!mark) return;
  await photograph(mark, true);
  await sendMarks([mark.id], true);
}

/* ── what a recording shows while it runs ────────────────────────────────── */

let counting = null;

/**
 * Put up the frame and the countdown, and hand the desktop back.
 *
 * Both halves matter. Without the frame a recording is fifteen seconds of a toolbar
 * that has vanished, and nobody can tell whether it is working or broken. Without
 * giving the input shape back it is fifteen seconds of a desktop that will not take a
 * click, which makes the recording a picture of somebody unable to do the thing they
 * wanted recorded.
 */
function startRecording(mark) {
  // Every record mark is dragged out, so this is a guard rather than a case: a mark
  // with no region has no area to show, and inventing one would be a lie about what is
  // in the pictures.
  if (!mark.region) return;
  state.recording = {
    box: mark.region.box,
    until: Date.now() + state.recordFor * 1000,
  };
  drawRecording();
  // The shape is settled once: what it becomes does not change while the seconds run
  // down, and asking the window manager to re-shape ten times a second for a number
  // that is only being read would be work nobody can see.
  shape();
  // Tenths, not seconds: a countdown that redraws on its own second boundary sits on
  // the wrong number for up to a second, which on a two-second recording is half of it.
  counting = setInterval(drawRecording, 100);
}

function stopRecording() {
  if (counting !== null) clearInterval(counting);
  counting = null;
  if (!state.recording) return;
  state.recording = null;
  drawRecording();
  // And the desktop stops being entirely the desktop again. Left alone, the overlay
  // would keep catching nothing while it drew the popup over the region.
  shape();
}

function drawRecording() {
  const now = state.recording;
  el.recording.hidden = now === null;
  if (!now) return;
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const frame = recordFrame(now.box, screen);
  el.recordingArea.style.left = `${frame.x * 100}%`;
  el.recordingArea.style.top = `${frame.y * 100}%`;
  el.recordingArea.style.width = `${frame.w * 100}%`;
  el.recordingArea.style.height = `${frame.h * 100}%`;
  // Above the frame where there is room for it, below where there is not — a badge
  // half off the top of the screen is the one place it cannot be read.
  el.recordingArea.dataset.under = String(frame.y * screen.height < 34);
  el.recordingLeft.textContent = `${secondsLeft(now.until, Date.now())}s`;
}

/**
 * Every watched region, drawn where it is.
 *
 * Outside the pixels the pictures come from, on the same clearance the recording frame
 * uses and for the same reason. Dashed rather than solid, because this one is not
 * happening now — it is a thing left running, and it should not read like a recording
 * in progress.
 */
function drawWatching() {
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const who = receiver();
  el.watching.replaceChildren(
    ...state.watching.map((held) => {
      const frame = recordFrame(held.box, screen);
      const area = document.createElement("div");
      area.className = "watching-area";
      area.style.left = `${frame.x * 100}%`;
      area.style.top = `${frame.y * 100}%`;
      area.style.width = `${frame.w * 100}%`;
      area.style.height = `${frame.h * 100}%`;
      area.dataset.under = String(frame.y * screen.height < 34);
      // The badge says where the answer is going, not just that something is running.
      // "Watching" alone leaves somebody to remember which agent they had selected
      // twenty minutes ago, which is the thing nobody remembers.
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "watching-badge";
      badge.textContent = who ? `watching \u2192 ${who.name}` : "watching";
      badge.title = "Stop watching this region";
      badge.setAttribute("aria-label", "Stop watching this region");
      badge.addEventListener("click", () => void stopWatching(held.id, true));
      area.append(badge);
      return area;
    }),
  );
}

function drawMarks() {
  const live = document.getElementById("live");
  const drawn = [];
  for (const mark of state.marks) {
    // A span has no region — it is two points and the distance between them — so the
    // shape cannot be read off the mark the way a box's can. Without this the number
    // was drawn and the line it measures was not.
    const kind = DRAWS[mark.tool] === "span" ? "span" : mark.tool === "draw" ? "stroke" : mark.region && mark.region.shape;
    if (!kind) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathFor({ kind, points: mark.points }));
    path.setAttribute(
      "fill",
      kind === "stroke" || kind === "span"
        ? "none"
        : "color-mix(in srgb, var(--accent, #ff6b6b) 13%, transparent)",
    );
    path.setAttribute("stroke", "var(--accent, #ff6b6b)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    drawn.push(path);
  }
  // The live path belongs to the gesture, not to this list, so it is put back rather
  // than swept away mid-drag.
  el.marks.replaceChildren(...drawn);
  if (live) el.marks.append(live);

  let number = 0;
  const drawnPins = state.marks
    .filter((mark) => mark.tool === "pointAt")
    .map((mark) => {
      const pin = document.createElement("span");
      pin.className = "pin";
      pin.style.left = `${mark.points[0].x * 100}%`;
      pin.style.top = `${mark.points[0].y * 100}%`;
      pin.textContent = String(++number);
      return pin;
    });
  // A measurement's whole point is its number, so the number is on the screen and not
  // only in the message. Written in HTML rather than into the marks layer, which is a
  // unit square stretched to the display and would stretch the text with it.
  for (const mark of state.marks) {
    if (mark.tool !== "measure" || typeof mark.px !== "number") continue;
    drawnPins.push(spanLabel(mark.points, `${mark.px}px`));
  }
  el.pins.replaceChildren(...drawnPins);
}

/**
 * The only thing the rail says on its own, and it only says it when something is wrong.
 *
 * There used to be a line here after every action, naming the tool, the window in front
 * and who was receiving. All three are already on the rail, so it was the toolbar
 * reading its own state back — the kind of thing somebody notices once and then never
 * reads again, while it sits over their work.
 */
/**
 * What an agent actually said, out of a message that may be many things.
 *
 * A turn carries tool calls, reasoning and images as well as words. Only the words are
 * an answer, and only from the other side — the echo of the question going in is not a
 * reply to it.
 */
function spokenBy(message) {
  if (!message || message.role !== "assistant") return null;
  const content = message.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const words = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return words || null;
}

/** The overlay's own size, which is what a fraction of it is a fraction of. */
function screenNow() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function spanLabel(points, said) {
  const [from, to] = [points[0], points[points.length - 1]];
  const label = document.createElement("span");
  label.className = "span-label";
  label.style.left = `${((from.x + to.x) / 2) * 100}%`;
  label.style.top = `${((from.y + to.y) / 2) * 100}%`;
  label.textContent = said;
  return label;
}

/**
 * The answers, waiting or arrived, on the regions they are about.
 *
 * Each one is measured for the input shape on its own rather than as a group: a pin at
 * one corner of the screen and a pin at the other would otherwise claim everything
 * between them, and everything between them is somebody's desktop.
 */
function drawAnswers() {
  el.answers.replaceChildren(
    ...state.answers.map((answer) => {
      const at = document.createElement("div");
      at.className = "answer-at";
      at.style.left = `${answer.at.x * 100}%`;
      at.style.top = `${answer.at.y * 100}%`;

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "answer-dot";
      dot.dataset.waiting = String(!answer.said);
      dot.title = answer.said ? `Reply from ${answer.who}` : `Waiting on ${answer.who}`;
      dot.textContent = answer.said ? "" : "…";
      dot.addEventListener("click", () => {
        answer.open = !answer.open;
        render();
      });
      at.append(dot);

      if (answer.open && answer.said) {
        const panel = document.createElement("div");
        panel.className = "answer-said";

        const head = document.createElement("div");
        head.className = "answer-head";
        const who = document.createElement("p");
        who.className = "answer-who";
        who.textContent = answer.who;
        // Closing is not deciding. The answer stays where it is and the pin stays with
        // it, because reading something and having an opinion about it are two moments
        // and this surface should not insist they are one.
        const shut = document.createElement("button");
        shut.type = "button";
        shut.className = "popup-shut";
        shut.title = "Close · the answer stays";
        shut.setAttribute("aria-label", "Close this answer");
        shut.textContent = "\u00d7";
        shut.addEventListener("click", () => {
          answer.open = false;
          render();
        });
        head.append(who, shut);

        const said = document.createElement("p");
        said.className = "answer-text";
        said.textContent = answer.said;

        const foot = document.createElement("div");
        foot.className = "popup-foot";
        const no = document.createElement("button");
        no.type = "button";
        no.className = "popup-do";
        no.disabled = Boolean(answer.saying);
        no.textContent = "Decline";
        no.title = "Tell them this is not it";
        no.addEventListener("click", () => void verdict(answer, "Declined — that is not what I meant."));
        const yes = document.createElement("button");
        yes.type = "button";
        yes.className = "popup-do popup-go";
        yes.disabled = Boolean(answer.saying);
        yes.textContent = answer.saying ? "Sending…" : "Accept";
        yes.title = "Tell them to go ahead";
        yes.addEventListener("click", () => void verdict(answer, "Accepted — go ahead."));
        foot.append(no, yes);

        panel.append(head, said, foot);
        at.append(panel);
      }
      return at;
    }),
  );
}

/**
 * Say yes or no to an answer, in the conversation it came from.
 *
 * A verdict that went nowhere would be theatre: the point of the answer coming back
 * here is that the agent hears what you make of it, and the place it hears anything is
 * the conversation. So this is a real message, and the agent may well say something
 * back — which is what agreeing or disagreeing with somebody looks like.
 */
async function verdict(answer, said) {
  if (answer.saying) return;
  answer.saying = true;
  render();
  try {
    await invoke("colai_send", {
      receiver: { kind: "session", id: answer.sessionKey, locator: null },
      message: said,
      markIds: [],
    });
    answer.saying = false;
    await forgetAnswer(answer);
  } catch (error) {
    answer.saying = false;
    state.trouble = `Could not reply — ${error && error.message ? error.message : String(error)}`;
    render();
  }
}

/** Stop waiting on a conversation, and stop the Gateway talking to nobody. */
async function forgetAnswer(answer) {
  state.answers = state.answers.filter((held) => held !== answer);
  render();
  const still = state.answers.some((held) => held.sessionKey === answer.sessionKey);
  if (!still) await invoke("colai_unwatch", { sessionKey: answer.sessionKey }).catch(() => {});
}

function drawTrouble() {
  el.trouble.hidden = !state.trouble;
  el.trouble.textContent = state.trouble || "";
}

/**
 * Where the toolbar exists on the screen, so everywhere else belongs to the desktop.
 *
 * Only crosses to Rust when the answer changes: this runs on every render, and a round
 * trip per frame would be absurd.
 */
let shaped = "";
function shape() {
  // The popup opens over the region it is about, well away from the rail, so the two are
  // measured as two rectangles rather than one that swallows the desktop between them.
  // A recording is the one time this window has to get out of the way entirely. Every
  // tool holds a sheet of glass over the whole desk so it can catch a drag, and holding
  // it for fifteen seconds would mean nothing on the desktop could be clicked while the
  // desktop was being filmed — a recording of somebody unable to do the thing they
  // wanted recorded. Nothing here needs clicking, so nothing here is caught: the frame
  // and the countdown are pixels on the glass and the desktop is the desktop.
  const rects = state.recording
    ? []
    : state.tool !== "pointer"
      ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]
      : [boxAround(el.wrap)];
  if (state.popup !== null && !el.popup.hidden) rects.push(boxAround(el.popup));
  // One at a time, not as a union: a watch on each screen would otherwise claim the
  // whole desk between them, which is the mistake the answer pins below already avoid.
  for (const area of el.watching.children) rects.push(boxAround(area.firstChild));
  for (const answer of el.answers.children) rects.push(boxAround(answer));
  const key = JSON.stringify(rects);
  if (key === shaped) return;
  shaped = key;
  void invoke("colai_shape", { rects });
}

/**
 * An element's box, widened to hold everything it draws.
 *
 * A flyout opens beside the rail and a menu hangs below it, both positioned outside
 * their parent's box — so the parent's own rectangle does not contain them, and a shape
 * measured from it leaves them visible and dead to the pointer.
 */
function boxAround(node) {
  const own = node.getBoundingClientRect();
  let [left, top, right, bottom] = [own.left, own.top, own.right, own.bottom];
  // Depth-first, so a scrolling list can be taken as a leaf. Its rows below the fold
  // still report boxes past its bottom edge, and counting them would claim a strip of
  // desktop that shows nothing — the same mistake as missing a flyout, upside down.
  const pending = [...node.children];
  while (pending.length) {
    const child = pending.pop();
    const box = child.getBoundingClientRect();
    // Both axes, read separately: the `overflow` shorthand reports nothing useful when
    // the two differ, which is exactly the case here — a list that scrolls vertically.
    const style = getComputedStyle(child);
    if (style.overflowX === "visible" && style.overflowY === "visible") {
      pending.push(...child.children);
    }
    if (!box.width || !box.height) continue;
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  return {
    x: Math.round(left - 18),
    y: Math.round(top - 18),
    width: Math.round(right - left + 36),
    height: Math.round(bottom - top + 36),
  };
}

/* ── keys ────────────────────────────────────────────────────────────────── */

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.popup !== null) {
    cancelMark(state.popup);
    return;
  }
  if (event.key === "Escape" && state.comparing !== null) {
    // A before with no after is half a thought. Escape drops it the way it drops a
    // popup: onto the redo trail, not into nothing.
    cancelMark(state.comparing);
    return;
  }
  if (event.key === "Escape") {
    use("pointer");
    void invoke("colai_release");
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  // Never while somebody is writing: a single letter is a shortcut only when it is not
  // a character they meant to type.
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
    return;
  const tool = KEYS[event.key.toLowerCase()];
  if (tool) {
    event.preventDefault();
    use(tool);
  }
});

/* ── start ───────────────────────────────────────────────────────────────── */

/**
 * A failure the person can see.
 *
 * An overlay that throws on startup looks exactly like one that is working and has
 * nothing to say: the rail is drawn, and nothing responds. This is the same strip a
 * failed send uses, which is the whole reason it survived the line that used to sit
 * there narrating the current tool.
 */
function sayFailed(message) {
  // Also the window title, which survives a page that cannot draw and is readable from
  // outside the app while this is being worked on.
  document.title = `toolbar error: ${message}`;
  state.trouble = `The toolbar hit an error — ${message}`;
  try {
    drawTrouble();
  } catch {
    // Nothing left to do: if drawing the message also throws, saying so louder will not
    // help, and throwing from an error handler loses the original.
  }
}

/*
 * Files dragged onto the toolbar.
 *
 * Tauri's own drag-and-drop rather than the page's, because the page's gives a browser
 * File — bytes, no path, and nothing at all for a folder — where this gives the real
 * paths on disk. That is the difference between attaching a copy of something and
 * naming the thing itself, and a folder can only be named.
 *
 * The overlay is input-shaped, so a drop only lands where the toolbar actually is: the
 * rail, or the composer when it is open. Everywhere else the drag goes through to the
 * desktop, which is right — the transparent part of this window is not a window.
 */
/*
 * A watched region moved, or stopped being watched without moving.
 *
 * Two events rather than one with a flag, because they are two different things to a
 * person: one produces a message and the other produces a marker quietly disappearing,
 * and the second has to say why or it looks like the toolbar forgot.
 */
listen("colai:watch-changed", (event) => {
  void watchFired(event.payload.markId);
});
listen("colai:watch-ended", (event) => {
  const { markId, why, says } = event.payload;
  void stopWatching(markId, false);
  // "stopped" is somebody pressing the badge; they know. The rest is the toolbar
  // giving up, which nobody asked for and everybody should be told about.
  if (why === "stopped") return;
  state.trouble = says
    ? `Stopped watching that region — ${says}.`
    : "Stopped watching that region.";
  render();
});

listen("tauri://drag-enter", (event) => {
  state.catching = onTheToolbar(event);
  render();
});
listen("tauri://drag-leave", () => {
  state.catching = false;
  render();
});
listen("tauri://drag-drop", async (event) => {
  state.catching = false;
  const paths = (event.payload && event.payload.paths) || [];
  // Let go over the desktop, not over the toolbar. The window is the size of the whole
  // desk, and while a marking tool is out its input shape is the whole desk too, so
  // catching every drop would mean a file dragged to somebody's desktop quietly landing
  // in a message instead. The drawn rectangles are the promise; the window is not.
  if (!paths.length || !onTheToolbar(event)) {
    render();
    return;
  }
  try {
    bringFiles(await invoke("colai_describe_files", { paths }));
  } catch (error) {
    sayFailed(`Could not read what was dropped — ${error && error.message ? error.message : String(error)}`);
  }
});

/** Whether a drag is over the part of this window somebody can actually see. */
function onTheToolbar(event) {
  const at = event.payload && event.payload.position;
  if (!at) return false;
  // Physical pixels from the window manager, CSS pixels from the page.
  const scale = window.devicePixelRatio || 1;
  const [x, y] = [at.x / scale, at.y / scale];
  const inside = (box) =>
    x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
  if (inside(boxAround(el.wrap))) return true;
  return state.popup !== null && !el.popup.hidden && inside(boxAround(el.popup));
}

// WebKit's own context menu has nothing on it that belongs on a screen overlay — and
// worse, it is a native window that outlives the toolbar's shape, so it appears over the
// desktop and has to be dismissed before anything else can be clicked.
window.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("error", (event) => sayFailed(event.message || String(event.error)));

/*
 * Rejections as well as errors.
 *
 * Startup is an async function, so anything it throws is a rejected promise rather than
 * an `error` event — and listening only for the latter is how a toolbar comes up drawn
 * but dead, with nothing anywhere saying why.
 */
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  sayFailed(reason && reason.message ? reason.message : String(reason));
});

async function start() {
  buildRail();
  try {
    state.screens = (await invoke("colai_screens")) || [];
  } catch {
    state.screens = [];
  }
  // One screen the size of the window, when the shell cannot say. Everything below
  // works in screens, and none of it should have to ask whether there are any.
  if (state.screens.length === 0) {
    state.screens = [
      {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        reserved: NOTHING_RESERVED,
      },
    ];
  }
  listenForDrag();
  recall();
  place();

  await learnFront();

  // Answers, as they arrive. A session says a great deal — the question going in, the
  // work coming out — and only what an agent finally said back is an answer to what was
  // pointed at.
  void listen("colai:reply", (event) => {
    const payload = event && event.payload;
    if (!payload) return;
    const waiting = state.answers.find(
      (answer) => answer.sessionKey === payload.sessionKey && !answer.said,
    );
    if (!waiting) return;
    const said = spokenBy(payload.message);
    if (!said) return;
    waiting.said = said;
    render();
  }).catch(() => {});

  void loadWho();
  // The Gateway connects a moment after the app does, so the first ask usually lands
  // before there is anything to answer it. Asked again rather than leaving the rail
  // saying "unavailable" until somebody happens to open the menu.
  for (const wait of [1500, 4000, 9000]) {
    setTimeout(() => {
      if (state.whoTrouble) void loadWho();
    }, wait);
  }
  render();
  clamp();
  // The rail redraws itself when a flyout opens, and the shape has to grow to hold it.
  new MutationObserver(shape).observe(el.wrap, {
    childList: true,
    subtree: true,
    attributes: true,
  });
}

void start();
