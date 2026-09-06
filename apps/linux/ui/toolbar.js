// The toolbar: point at anything on screen and hand it to an agent.
//
// Pure decisions stay above the browser bindings so a Node test can exercise them
// without a WebView, the way quickchat.js is arranged.

/**
 * The tools, and which of them ask a surface to change.
 *
 * The second column is the whole point. Reading is universal — the toolbar can mark and
 * describe anything on screen — and *changing* something is only possible where a
 * connector owns the surface. A tool that writes and a tool that only marks are
 * different in kind, so that difference is data here rather than a branch buried in a
 * handler.
 *
 * Nothing writes yet, and that is not the column going unused. Creating a wireframe
 * asks an agent to write a document; it never reaches into the application that was
 * pointed at, and calling it a write would have the gate refuse a tool that was never
 * going to touch the surface. The column means what it says, and the first tool that
 * genuinely changes somebody's window will be refused by it until a connector owns
 * that window.
 */
const TOOLS = {
  pointer: { label: "Pointer", press: "V", glyph: "pointer", writes: false },
  pointAt: { label: "Point at", press: "P", glyph: "pointAt", writes: false },
  draw: { label: "Draw", press: "D", glyph: "draw", writes: false },
  box: { label: "Box", press: "B", glyph: "box", writes: false },
  circle: { label: "Circle", press: "O", glyph: "circle", writes: false },
  wireframe: { label: "Create wireframe", glyph: "wireframe", writes: false },
  screenshot: { label: "Screenshot", glyph: "screenshot", writes: false },
};

/**
 * What a batch of marks is being sent *for*.
 *
 * The instruction an agent is given changes what comes back more than anything else in
 * the message, and it is the one thing somebody should not have to type again every
 * time. Data rather than branches, so the chips on the composer and the sentence in the
 * message are read from the same place and cannot drift apart.
 */
const MODES = {
  ask: { label: "Ask", says: "Answer the question. Do not change anything yet." },
  plan: {
    label: "Plan",
    says: "Work out what needs to change and lay out the steps. Do not edit anything yet.",
  },
  debug: {
    label: "Debug",
    says: "Work out why this is happening, and read the code before concluding anything.",
  },
  build: { label: "Build", says: "Make this change." },
};

/** Where a wireframe goes when nobody says otherwise. */
const WIREFRAME_HOME = "docs/Design/";

/**
 * What each tool draws while it is being dragged, if anything.
 *
 * A screenshot and a wireframe drag out a region like any other area tool. Released
 * without having moved, they mean the whole display — the one gesture where a click
 * that selected nothing is a request rather than a slip.
 */
const DRAWS = {
  box: "box",
  circle: "ellipse",
  draw: "stroke",
  screenshot: "box",
  wireframe: "box",
};

/** The tools for which a click that selected nothing means the whole display. */
const WHOLE_DISPLAY = ["screenshot", "wireframe"];

/** Single letters that pick a tool, from the tooltips the rail shows. */
const KEYS = { v: "pointer", p: "pointAt", d: "draw", b: "box", o: "circle" };

/**
 * What the agent actually reads.
 *
 * The pictures carry what a region looks like. This carries what was meant by it: which
 * tool made each mark, what was written on it, and what the whole batch is for. Numbered
 * to match the order the pictures are attached in, because an agent looking at three
 * images needs to know which sentence belongs to which one, and "the second thing" is
 * not an answer when the images arrive as a set.
 *
 * The instruction goes last. Everything above it is what is being talked about, and the
 * last line is what to do — the same order a person would say it out loud.
 */
function summaryFor(marks, mode, text, surface) {
  const said = [];
  const said_of = (mark, at) => {
    const tool = TOOLS[mark.tool];
    const note = (mark.note || "").trim();
    const named = `${at + 1}. ${tool ? tool.label : mark.tool} (mark-${at + 1}.png)`;
    return note ? `${named} — ${note}` : named;
  };
  if (marks.length) {
    const where = (surface && surface.app) || "screen";
    said.push(
      marks.length === 1
        ? `One thing marked on ${where}:`
        : `${marks.length} things marked on ${where}:`,
    );
    said.push("");
    marks.forEach((mark, at) => said.push(said_of(mark, at)));
    // A wireframe is the one mark that asks for a file rather than an opinion, so it
    // says where the file goes. Stated per mark: two of them in one batch are two
    // documents, not one with two names.
    marks.forEach((mark, at) => {
      if (mark.tool !== "wireframe") return;
      const home = (mark.dest || "").trim() || WIREFRAME_HOME;
      said.push("");
      said.push(
        `Turn mark-${at + 1}.png into a wireframe and write it to ${home}, matching the ` +
          `.dc.html documents already there — the same <x-dc> wrapper and the shared _ds/ ` +
          `stylesheets they use.`,
      );
    });
    said.push("");
  }
  const asked = MODES[mode] || MODES.plan;
  said.push(`${asked.label}: ${asked.says}`);
  const own = (text || "").trim();
  if (own) {
    said.push("");
    said.push(own);
  }
  return said.join("\n");
}

/**
 * How close to an edge counts as docked.
 *
 * Wide enough that somebody aiming for the edge hits it, narrow enough that a rail
 * parked near the side is not dragged into an orientation change it was not asked for.
 */
const DOCK_WITHIN = 80;
/** How far the hand has to leave an edge before the rail gives that edge up. */
const DOCK_LEAVE = 120;
/** How much nearer a rival edge has to be before it takes a dock over. */
const DOCK_BEAT = 24;
/** How far a docked rail sits from the edge of the room it has. */
const EDGE = 14;

const NOTHING_RESERVED = { top: 0, right: 0, bottom: 0, left: 0 };

function isVertical(dock) {
  return dock === "left" || dock === "right";
}

/**
 * The part of a screen the toolbar may use.
 *
 * Not the whole screen. A desktop's own panels — GNOME's top bar, Ubuntu's dock — are
 * drawn by the compositor above every window, so a toolbar docked flush to a screen edge
 * disappears underneath one. Keeping out of them is the only arrangement where both stay
 * visible.
 *
 * Per screen, because the overlay covers the whole desk and the desk is not one screen.
 * The shell's panel is along the top of one display and nowhere near the other; four
 * numbers for the desk as a whole would either lose the panel or reserve a strip of a
 * screen that has none.
 */
function usable(screen) {
  const edges = (screen && screen.reserved) || NOTHING_RESERVED;
  return {
    left: screen.x + edges.left,
    top: screen.y + edges.top,
    right: screen.x + screen.width - edges.right,
    bottom: screen.y + screen.height - edges.bottom,
  };
}

/**
 * Which screen something is on.
 *
 * The nearest one when it is on none — a desk of two displays that do not line up has
 * gaps between and beside them, and a point in a gap still has to belong somewhere or
 * the rail has no edges to dock to.
 */
function screenAt(screens, at) {
  if (!screens || screens.length === 0) return null;
  const holding = screens.find(
    (screen) =>
      at.x >= screen.x &&
      at.x < screen.x + screen.width &&
      at.y >= screen.y &&
      at.y < screen.y + screen.height,
  );
  if (holding) return holding;
  return screens.reduce((best, screen) => (awayFrom(screen, at) < awayFrom(best, at) ? screen : best));
}

/** How far a point is from a screen's box, zero when it is inside it. */
function awayFrom(screen, at) {
  const across = Math.max(screen.x - at.x, 0, at.x - (screen.x + screen.width));
  const down = Math.max(screen.y - at.y, 0, at.y - (screen.y + screen.height));
  return Math.hypot(across, down);
}

/**
 * Which edge a drag is claiming, decided from the hand rather than from the rail.
 *
 * The rail's own box cannot answer this. A horizontal rail is around 480 wide and a
 * vertical one around 44, so a gap measured from the box depends on the answer the box
 * already has — dock to the right, turn, and the gap that decided it is suddenly 400px
 * wider, so it undocks, turns back, and docks again. That ran at pointer speed and read
 * as the toolbar shivering in the corner.
 *
 * The hand is the one thing in this that nothing here moves, so distances come from it,
 * and two margins make the answer decisive. An edge is not given up until the hand is
 * well clear of it, and a rival has to be meaningfully nearer before it takes over —
 * so in a corner, where two edges are both within reach, the toolbar commits to one and
 * stays there until you plainly mean the other.
 */
function dockFor(at, screens, was) {
  const screen = screenAt(screens, at);
  if (!screen) return null;
  const room = usable(screen);
  const gaps = {
    left: at.x - room.left,
    right: room.right - at.x,
    top: at.y - room.top,
    bottom: room.bottom - at.y,
  };
  // Ties keep the earlier edge, so a corner has one answer rather than two.
  const nearest = Object.keys(gaps).reduce((best, edge) =>
    gaps[edge] < gaps[best] ? edge : best,
  );
  const held = was && was in gaps;
  if (held && gaps[was] <= DOCK_LEAVE) {
    return gaps[nearest] + DOCK_BEAT < gaps[was] ? nearest : was;
  }
  return gaps[nearest] < DOCK_WITHIN ? nearest : null;
}

/** The smallest box containing every point, in fractions of the surface. */
function boxOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** An SVG path for a gesture, in the 0..1 space the marks layer draws in. */
function pathFor(shape) {
  if (!shape || shape.points.length === 0) return "";
  const points = shape.points;
  if (shape.kind === "stroke") {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  }
  const box = boxOf(points);
  if (shape.kind === "ellipse") {
    const rx = box.w / 2;
    const ry = box.h / 2;
    const cx = box.x + rx;
    const cy = box.y + ry;
    // Two arcs, because a single one cannot close a full ellipse.
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }
  return `M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`;
}

/**
 * What a receipt says about what just happened.
 *
 * One sentence naming the action, where it landed and who has it. `blocked` is not a
 * failure to report politely — it is the product working: the region was noticed and
 * nothing was changed.
 */
function receiptFor(tool, surface, agent) {
  const label = TOOLS[tool].label;
  if (TOOLS[tool].writes && !(surface && surface.connector)) {
    return {
      did: `${label} — ${(surface && surface.app) || "That app"} isn't connected`,
      through: "Region noted, nothing changed",
      agent,
      blocked: true,
    };
  }
  return {
    did: label,
    through: (surface && (surface.connector || surface.app)) || "nothing in front",
    agent,
    blocked: false,
  };
}

/** A count with its noun, so the rail reads as a sentence rather than a gauge. */
function counted(many, noun) {
  return `${many} ${noun}${many === 1 ? "" : "s"}`;
}

/* ── browser bindings ─────────────────────────────────────────────────────── */

const tauri = window["__TAURI__"];
const invoke = tauri ? tauri.core.invoke : async () => undefined;

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
  settings:
    '<path d="M4 8h16M4 16h16"/><circle cx="9.5" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="14.5" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  wireframe:
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M7 8h10M7 12h6M7 16h8"/>',
  screenshot:
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8z"/>',
};

function icon(name, size) {
  return `<svg width="${size || 17}" height="${size || 17}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

const WHERE = "openclaw.toolbar.where";

const el = {
  wrap: document.getElementById("rail-wrap"),
  rail: document.getElementById("rail"),
  grip: document.getElementById("grip"),
  flyShape: document.getElementById("fly-shape"),
  flyDesign: document.getElementById("fly-design"),
  flyAgents: document.getElementById("fly-agents"),
  agentRows: document.getElementById("agent-rows"),
  receipt: document.getElementById("receipt"),
  marks: document.getElementById("marks"),
  pins: document.getElementById("pins"),
  capture: document.getElementById("capture"),
  popup: document.getElementById("popup"),
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
  // the same name can belong to both and the receipt has to be able to say.
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
  // What the next send is for, and anything else somebody wants to say with it.
  mode: "plan",
  text: "",
  // Conversations held elsewhere that have already been agreed to. Continuing one hands
  // it to the Gateway, which is a real change of ownership, so it is asked once and then
  // remembered rather than asked on every send.
  adopted: [],
  // Set while a send is in the air, so a second click cannot post it twice.
  sending: false,
};

/* ── the rail ───────────────────────────────────────────────────────────── */

const buttons = {};

function key(id, title, glyph, onClick, caret) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = icon(glyph) + (caret ? '<span class="caret">▾</span>' : "");
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

  const gear = key("settings", "Settings · ⌘,", "settings", () =>
    invoke("colai_open_settings"),
  );
  dividers[2].after(send, agents, gear);

  row(el.flyShape, "box", "Box", "box", "B");
  row(el.flyShape, "circle", "Circle", "circle", "O");
  row(el.flyDesign, "wireframe", "Create wireframe", "wireframe");
  row(el.flyDesign, "screenshot", "Screenshot", "screenshot");
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
  const who = receiver();
  state.receipt = receiptFor(tool, state.surface, who ? who.name : null);
  render();
}

/**
 * The agent or session currently marked as receiving, whichever it is.
 *
 * Returned as one shape so everything downstream — the rail's label, the receipt, the
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
  if (state.open === "agents") void loadWho();
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

  addMark({
    tool: state.tool,
    region:
      finished.kind === "stroke"
        ? null
        : { shape: finished.kind === "ellipse" ? "ellipse" : "box", box },
    points: finished.points,
  });
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

  const step = () => {
    liveFrame = requestAnimationFrame(step);
    if (!gesture) return;
    const d = pathFor(gesture);
    if (d === previous) return;
    previous = d;
    path.setAttribute("d", d);
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
async function shoot(mark) {
  document.body.style.visibility = "hidden";
  try {
    await new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)));
    await new Promise((waited) => setTimeout(waited, 40));
    const taken = await invoke("colai_capture_mark", { mark, accent: accentNow() });
    mark.thumb = taken.thumb;
    mark.shot = `${taken.width}\u00d7${taken.height}`;
  } catch (error) {
    // The mark still exists and can still be described; it simply arrives without a
    // picture. Saying which is better than a popup that looks broken.
    mark.trouble = error && error.message ? error.message : String(error);
  } finally {
    document.body.style.visibility = "";
  }
  state.popup = mark.id;
  render();
  // The note is a text field and one way out is a key, and neither works while the
  // window manager treats this window as scenery.
  void invoke("colai_take_keyboard").catch(() => {});
}

/** The colour the app is themed in, if it has told us one. */
function accentNow() {
  const said = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return said || undefined;
}

/* ── what to do with what was marked ─────────────────────────────────────── */

/**
 * Put a mark back, exactly as undo would.
 *
 * There are three ways out of the popup — the cross, Escape, and a click anywhere off
 * it — and all of them mean the same thing, because somebody who wants out of a dialog
 * should not have to work out which exit destroys their work. None of them do: the mark
 * goes onto the redo trail, so a dismissal that was not meant is one keystroke from
 * being taken back.
 */
function cancelMark(id) {
  const at = state.marks.findIndex((mark) => mark.id === id);
  if (at >= 0) state.undone.push(state.marks.splice(at, 1)[0]);
  state.popup = null;
  render();
}

/** The marks that go in the next send, in the order they were made. */
function chosenMarks() {
  return state.marks.filter((mark) => mark.chosen);
}

/** Who is receiving, as the shell needs them named. */
function receiverNow() {
  const who = state.receiving;
  if (!who.id) return null;
  return { kind: who.kind, id: who.id, locator: who.locator || null };
}

/** Whether sending to this receiver would hand a conversation over without asking. */
function needsAgreeing() {
  return state.receiving.kind === "thread" && !state.adopted.includes(state.receiving.id);
}

/**
 * Send what was marked.
 *
 * The message is composed here rather than in the shell, because what an agent reads is
 * a decision about the marks somebody made and belongs beside them. The shell resolves
 * the receiver, attaches the pictures and reports what happened.
 */
async function sendMarks(ids) {
  if (state.sending) return;
  const who = receiverNow();
  if (!who) {
    state.receipt = { did: "Nobody is receiving", through: "Choose an agent or a conversation first", agent: null, blocked: true };
    render();
    return;
  }
  const going = state.marks.filter((mark) => ids.includes(mark.id));
  state.sending = true;
  render();
  try {
    const sent = await invoke("colai_send", {
      receiver: who,
      message: summaryFor(going, state.mode, state.text, state.surface),
      markIds: ids,
    });
    if (who.kind === "thread") state.adopted = [...state.adopted, who.id];
    // What went is gone; what was left unticked is still there, which is the whole
    // point of being able to untick it.
    state.marks = state.marks.filter((mark) => !ids.includes(mark.id));
    state.text = "";
    state.popup = null;
    state.open = null;
    state.receipt = {
      did: `Sent ${counted(going.length, "mark")}`,
      through: state.receiving.name || who.id,
      agent: sent.pictures ? counted(sent.pictures, "picture") : "no pictures",
      blocked: false,
    };
  } catch (error) {
    state.receipt = {
      did: "Could not send",
      through: error && error.message ? error.message : String(error),
      agent: null,
      blocked: true,
    };
  } finally {
    state.sending = false;
    render();
  }
}

/** The popup that opens on a finished mark. */
function drawPopup() {
  const mark = state.marks.find((held) => held.id === state.popup);
  if (!mark) {
    el.popup.hidden = true;
    return;
  }
  el.popup.hidden = false;
  const rows = [];

  const head = document.createElement("div");
  head.className = "popup-head";
  if (mark.thumb) {
    const shot = document.createElement("img");
    shot.className = "popup-shot";
    shot.src = mark.thumb;
    shot.alt = "";
    head.append(shot);
  }
  const named = document.createElement("div");
  named.className = "popup-named";
  const what = document.createElement("strong");
  what.textContent = TOOLS[mark.tool] ? TOOLS[mark.tool].label : mark.tool;
  const size = document.createElement("span");
  size.className = "popup-size";
  size.textContent = mark.trouble ? mark.trouble : mark.shot || "taking a picture…";
  named.append(what, size);
  head.append(named);

  // The visible way out, beside the two ways that are not. A dialog with only "Keep"
  // and "Send" makes dismissing it look like a choice somebody has to make.
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "popup-shut";
  shut.title = "Discard this mark · Esc";
  shut.setAttribute("aria-label", "Discard this mark");
  shut.textContent = "\u00d7";
  shut.addEventListener("click", () => cancelMark(mark.id));
  head.append(shut);
  rows.push(head);

  const note = document.createElement("textarea");
  note.className = "popup-note";
  note.rows = 2;
  note.placeholder = "What about it?";
  note.value = mark.note || "";
  note.addEventListener("input", () => {
    mark.note = note.value;
  });
  rows.push(note);

  if (mark.tool === "wireframe") {
    const where = document.createElement("input");
    where.className = "popup-note popup-dest";
    where.type = "text";
    where.value = mark.dest || WIREFRAME_HOME;
    where.setAttribute("aria-label", "Where the wireframe document goes");
    where.addEventListener("input", () => {
      mark.dest = where.value;
    });
    rows.push(where);
  }

  const foot = document.createElement("div");
  foot.className = "popup-foot";
  const to = document.createElement("button");
  to.type = "button";
  to.className = "popup-to";
  to.textContent = state.receiving.name || "Choose who receives";
  to.title = "Change who receives this";
  to.addEventListener("click", () => {
    state.popup = null;
    flyout("agents");
  });
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "popup-do";
  keep.textContent = "Keep";
  keep.addEventListener("click", () => {
    state.popup = null;
    render();
  });
  const now = document.createElement("button");
  now.type = "button";
  now.className = "popup-do popup-go";
  now.disabled = state.sending;
  now.textContent = state.sending ? "Sending…" : needsAgreeing() ? "Send and adopt" : "Send now";
  now.addEventListener("click", () => void sendMarks([mark.id]));
  foot.append(to, keep, now);
  rows.push(foot);

  // Said before it happens, not after. Continuing a conversation held in another agent
  // hands it to the Gateway, and somebody driving that thread from a terminal should
  // find that out from the toolbar rather than from the terminal.
  if (needsAgreeing()) {
    const warned = document.createElement("p");
    warned.className = "popup-warn";
    warned.textContent = `Sending adopts “${state.receiving.name}” into OpenClaw, which takes it over from wherever it is running now.`;
    rows.splice(rows.length - 1, 0, warned);
  }

  el.popup.replaceChildren(...rows);
  placePopup(mark);
}

/**
 * Put the popup beside the mark it is about, and inside the screen.
 *
 * Beside rather than on top: covering the thing somebody just pointed at, while asking
 * them what they meant by it, is the one place this must not open.
 */
function placePopup(mark) {
  // A whole-display capture has no corner to sit beside, so it opens in the middle
  // rather than at Math.max of nothing, which is negative infinity and the top-left.
  const edges = mark.region
    ? {
        right: (mark.region.box.x + mark.region.box.w) * window.innerWidth,
        bottom: (mark.region.box.y + mark.region.box.h) * window.innerHeight,
      }
    : mark.points.length
      ? {
          right: Math.max(...mark.points.map((spot) => spot.x)) * window.innerWidth,
          bottom: Math.max(...mark.points.map((spot) => spot.y)) * window.innerHeight,
        }
      : { right: window.innerWidth / 2, bottom: window.innerHeight / 2 };
  el.popup.style.left = "0px";
  el.popup.style.top = "0px";
  const box = el.popup.getBoundingClientRect();
  // On the screen the mark is on: a popup for something marked on the second display
  // belongs there, not pinned inside the first one's edges.
  const room = usable(screenAt(state.screens, { x: edges.right, y: edges.bottom }));
  const left = Math.min(Math.max(edges.right + 14, room.left + EDGE), room.right - box.width - EDGE);
  const top = Math.min(Math.max(edges.bottom + 14, room.top + EDGE), room.bottom - box.height - EDGE);
  el.popup.style.left = `${Math.round(left)}px`;
  el.popup.style.top = `${Math.round(top)}px`;
}

/** The composer: everything marked so far, and what to do with the ticked ones. */
function drawComposer() {
  const rows = [];
  const title = document.createElement("p");
  title.className = "agents-title";
  title.textContent = "Send what you marked";
  rows.push(title);

  if (state.marks.length === 0) {
    const none = document.createElement("p");
    none.className = "agent-empty";
    none.textContent = "Nothing marked yet. Point at something, or just write below.";
    rows.push(none);
  }
  for (const mark of state.marks) {
    const row = document.createElement("label");
    row.className = "row mark-row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.className = "mark-tick";
    tick.checked = Boolean(mark.chosen);
    tick.addEventListener("change", () => {
      mark.chosen = tick.checked;
      render();
    });
    const shot = document.createElement("span");
    shot.className = "mark-shot";
    if (mark.thumb) {
      const picture = document.createElement("img");
      picture.src = mark.thumb;
      picture.alt = "";
      shot.append(picture);
    }
    const said = document.createElement("span");
    said.className = "agent-name";
    const tool = TOOLS[mark.tool] ? TOOLS[mark.tool].label : mark.tool;
    said.textContent = mark.note ? `${tool} — ${mark.note}` : tool;
    said.title = said.textContent;
    row.append(tick, shot, said);
    rows.push(row);
  }

  const modes = document.createElement("div");
  modes.className = "mode-row";
  for (const [id, mode] of Object.entries(MODES)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", String(state.mode === id));
    chip.textContent = mode.label;
    chip.title = mode.says;
    chip.addEventListener("click", () => {
      state.mode = id;
      render();
    });
    modes.append(chip);
  }
  rows.push(modes);

  const text = document.createElement("textarea");
  text.className = "popup-note";
  text.rows = 3;
  text.placeholder = "Anything else to say?";
  text.value = state.text;
  text.addEventListener("input", () => {
    state.text = text.value;
  });
  rows.push(text);

  if (needsAgreeing()) {
    const warned = document.createElement("p");
    warned.className = "popup-warn";
    warned.textContent = `Sending adopts “${state.receiving.name}” into OpenClaw, which takes it over from wherever it is running now.`;
    rows.push(warned);
  }

  const foot = document.createElement("div");
  foot.className = "popup-foot";
  const to = document.createElement("button");
  to.type = "button";
  to.className = "popup-to";
  to.textContent = state.receiving.name || "Choose who receives";
  to.addEventListener("click", () => flyout("agents"));
  const go = document.createElement("button");
  go.type = "button";
  go.className = "popup-do popup-go";
  const going = chosenMarks();
  go.disabled = state.sending || (going.length === 0 && !state.text.trim());
  go.textContent = state.sending
    ? "Sending…"
    : needsAgreeing()
      ? "Send and adopt"
      : going.length
        ? `Send ${counted(going.length, "mark")}`
        : "Send";
  go.addEventListener("click", () => void sendMarks(going.map((mark) => mark.id)));
  foot.append(to, go);
  rows.push(foot);

  el.flySend.replaceChildren(...rows);
}

/* ── where the rail sits ─────────────────────────────────────────────────── */

el.grip.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const box = el.wrap.getBoundingClientRect();
  let grabX = event.clientX - box.left;
  let grabY = event.clientY - box.top;
  let edge = state.dock;
  let last = { x: box.left, y: box.top };

  const move = (moved) => {
    const size = el.wrap.getBoundingClientRect();
    const hand = { x: moved.clientX, y: moved.clientY };
    // The screen under the hand, which changes mid-drag the moment the rail is carried
    // across the seam between two of them. Everything below is about that screen, so it
    // has to be worked out before the rail is placed rather than after.
    const room = usable(screenAt(state.screens, hand));
    const x = Math.max(room.left, Math.min(room.right - size.width, hand.x - grabX));
    const y = Math.max(room.top, Math.min(room.bottom - size.height, hand.y - grabY));
    const now = dockFor(hand, state.screens, edge);
    if (now !== edge) {
      const turned = isVertical(now) !== isVertical(edge);
      // A rail that was 420 wide and becomes 44 wide has no sensible relationship to
      // where the hand was on it; re-grabbing near the corner is what keeps it on screen.
      if (turned) {
        grabX = 20;
        grabY = 20;
      }
      edge = now;
      state.dock = now;
      state.open = null;
      if (turned) turn(render);
      else render();
    }
    last = { x, y };
    state.at = last;
    place();
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const size = el.wrap.getBoundingClientRect();
    const rest = { x: last.x, y: last.y };
    // The screen it was let go over, not the one it was picked up from.
    const room = usable(screenAt(state.screens, last));
    // Against the edge of the room the toolbar has, not the edge of the screen.
    if (edge === "left") rest.x = room.left + EDGE;
    if (edge === "right") rest.x = room.right - size.width - EDGE;
    if (edge === "top") rest.y = room.top + EDGE;
    if (edge === "bottom") rest.y = room.bottom - size.height - EDGE;
    state.at = rest;
    place();
    remember();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

/* ── turning between flat and upright ────────────────────────────────────── */

/** How long the rail takes to settle into a new orientation. */
const TURN = 240;
const TURN_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

let turning = null;

/**
 * Change the rail's orientation and let it dissolve into the new one.
 *
 * A row of tools and a column of them are two layouts with nothing in between, so this
 * is not a morph: animating the pill's size would squeeze the flex children underneath,
 * and animating the children alone would float them outside a pill that had already
 * snapped. What happens instead is a still picture of the old rail fading out over the
 * new one fading in, which is the one thing that genuinely reads as turning.
 *
 * The state changes at once and only the appearance lags. A drag reads the dock on
 * every pointer move and must never be handed a stale one — that was the flicker.
 *
 * The input shape is re-measured on every frame, because a rail drawn at 94% covers a
 * different part of the screen than a settled one, and a control that is drawn but not
 * clickable is the one thing an overlay must never have. The ghost is measured with it
 * rather than excluded: it is inert, but it is on screen, and the shape should say so.
 */
function turn(change) {
  if (still() || typeof el.rail.animate !== "function") {
    change();
    shape();
    return;
  }
  const ghost = ghostOf(el.rail);
  change();
  if (turning) {
    for (const running of turning) running.cancel();
  }
  const leaving = ghost.animate(
    [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.9)" },
    ],
    { duration: TURN * 0.6, easing: "ease-in" },
  );
  const arriving = el.rail.animate(
    [
      { opacity: 0, transform: "scale(0.9)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    { duration: TURN, easing: TURN_EASE },
  );
  turning = [leaving, arriving];
  const drop = () => ghost.remove();
  leaving.finished.then(drop, drop);
  const follow = () => {
    shape();
    if (arriving.playState === "running") requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  // A cancelled animation rejects; the turn that cancelled it is already drawing, so
  // there is nothing left to say about this one.
  arriving.finished.then(shape, () => {});
}

/**
 * A still picture of the rail, parked where the rail was.
 *
 * Inside the wrap so the shape measurement finds it, inert so it cannot be clicked, and
 * stripped of its ids so the real toolbar's elements stay the only ones with those
 * names while it is on screen.
 */
function ghostOf(rail) {
  const ghost = rail.cloneNode(true);
  const box = rail.getBoundingClientRect();
  const wrap = el.wrap.getBoundingClientRect();
  ghost.removeAttribute("id");
  for (const named of ghost.querySelectorAll("[id]")) named.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("ghost");
  ghost.style.left = `${box.left - wrap.left}px`;
  ghost.style.top = `${box.top - wrap.top}px`;
  ghost.style.width = `${box.width}px`;
  ghost.style.height = `${box.height}px`;
  el.wrap.append(ghost);
  return ghost;
}

/** Whether the desktop has asked for as little movement as possible. */
function still() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function place() {
  if (!state.at) return;
  el.wrap.style.left = `${state.at.x}px`;
  el.wrap.style.top = `${state.at.y}px`;
}

function remember() {
  try {
    window.localStorage.setItem(WHERE, JSON.stringify({ ...state.at, dock: state.dock }));
  } catch {
    // A toolbar that will not remember where it was put is worth more than one that
    // refuses to appear.
  }
}

function recall() {
  const room = usable(screenAt(state.screens, { x: 0, y: 0 }));
  try {
    const saved = window.localStorage.getItem(WHERE);
    if (saved) {
      const put = JSON.parse(saved);
      state.at = { x: put.x, y: put.y };
      state.dock = put.dock || null;
      return;
    }
  } catch {
    /* falls through to the default corner */
  }
  state.at = { x: room.left + 24, y: room.bottom - 120 };
}

/**
 * A remembered position, brought back inside the room that is actually available.
 *
 * The toolbar is put somewhere on one desktop and opened on another — a different
 * monitor, a dock that moved, a panel that was not there before. Without this it comes
 * back underneath the new chrome and looks broken on first sight.
 */
function clamp() {
  if (!state.at) return;
  const size = el.wrap.getBoundingClientRect();
  if (!size.width) return;
  const room = usable(screenAt(state.screens, state.at));
  state.at = {
    x: Math.min(Math.max(state.at.x, room.left + EDGE), room.right - size.width - EDGE),
    y: Math.min(Math.max(state.at.y, room.top + EDGE), room.bottom - size.height - EDGE),
  };
  place();
  // And tell the shell where the rail went.
  //
  // Moving without re-shaping leaves the clickable region where the rail *was*: the
  // toolbar draws in one place and answers the pointer in another, and every click on it
  // falls through to the desktop. Silent, and indistinguishable from a dead button.
  shape();
}

/* ── drawing the whole thing ─────────────────────────────────────────────── */

function render() {
  const vertical = isVertical(state.dock);
  el.wrap.dataset.vertical = String(vertical);
  el.wrap.dataset.dock = state.dock || "";

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
  el.flyAgents.hidden = state.open !== "agents";
  el.flySend.hidden = state.open !== "send";
  // Filled before it is placed. A menu is measured to decide whether it fits on the
  // screen, and measuring it empty answers a question about a different menu — which is
  // how a full list of conversations came to hang off the bottom of the display while
  // the same code, run again a moment later, put it back.
  if (state.open === "send") drawComposer();
  if (state.open === "agents") drawWho();
  for (const [node, from] of [
    [el.flyShape, 150],
    [el.flyDesign, 190],
    [el.flySend, 230],
    [el.flyAgents, 270],
  ]) {
    placeFlyout(node, vertical, from);
  }

  drawMarks();
  drawPopup();
  drawReceipt();
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

/**
 * Agents and conversations, as rows somebody picks from.
 *
 * Three states and they are genuinely different: could not ask, nothing there, and a
 * list. Collapsing the first two into "nobody yet" would blame the person for a Gateway
 * that is not answering.
 *
 * Two headed groups rather than one flat list, because picking an agent and picking a
 * conversation are different choices — one starts something, the other joins it.
 */
function drawWho() {
  if (state.whoTrouble) {
    const said = document.createElement("p");
    said.className = "agent-empty";
    said.textContent = `Could not reach the Gateway — ${state.whoTrouble}`;
    el.agentRows.replaceChildren(said);
    return;
  }
  if (state.agents.length === 0 && talking() === 0) {
    const empty = document.createElement("p");
    empty.className = "agent-empty";
    empty.textContent = "Nobody yet. Start a conversation in the OpenClaw window and it appears here.";
    el.agentRows.replaceChildren(empty);
    return;
  }

  const rows = [];
  if (state.agents.length) {
    rows.push(group("Agents"));
    for (const agent of state.agents) {
      rows.push(
        whoRow({
          face: agent.emoji || agent.name.slice(0, 1).toUpperCase(),
          name: agent.name,
          receiving: state.receiving.kind === "agent" && state.receiving.id === agent.id,
          onPick: () => receive("agent", agent.id, agent.name, agent.emoji),
        }),
      );
    }
  }
  // Only when there are some: a heading over nothing reads as a list that failed to
  // load, and the machine having no conversations yet is not a failure.
  if (state.sessions.length) {
    rows.push(group("Conversations"));
    for (const session of state.sessions) {
      rows.push(
        whoRow({
          face: emojiFor(session) || session.title.slice(0, 1).toUpperCase(),
          name: session.title,
          note: session.busy ? "Running" : session.unread ? "Unread" : null,
          busy: session.busy,
          receiving: state.receiving.kind === "session" && state.receiving.id === session.key,
          onPick: () => receive("session", session.key, session.title, emojiFor(session)),
        }),
      );
    }
  }
  // Grouped under whoever holds them, then under the folder each belongs to, because
  // "Claude Code" and "which project" are the two things you need before a thread's own
  // name means anything.
  const open = openedProjects();
  let holder = null;
  for (const project of state.projects) {
    if (project.holder !== holder) {
      holder = project.holder;
      rows.push(group(holder));
    }
    // A folder with no name holds threads that belong to no project; they are listed
    // where they are rather than filed under something invented.
    if (project.label === null) {
      rows.push(...project.threads.map(threadRow));
      continue;
    }
    rows.push(projectRow(project, open.has(project.key)));
    if (open.has(project.key)) rows.push(...project.threads.map(threadRow));
  }
  el.agentRows.replaceChildren(...rows);
}

/** A folder, as a row that opens. */
function projectRow(project, open) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row row-project";
  row.setAttribute("aria-expanded", String(open));
  if (project.path) row.title = project.path;

  const twist = document.createElement("span");
  twist.className = "twist";
  twist.textContent = "▸";
  twist.dataset.open = String(open);

  const label = document.createElement("span");
  label.className = "agent-name";
  label.textContent = project.label;

  const many = document.createElement("span");
  many.className = "row-key";
  many.textContent = String(project.threads.length);

  row.append(twist, label, many);
  row.addEventListener("click", () => toggleProject(project.key));
  return row;
}

/** A conversation inside a folder, indented under it. */
function threadRow(thread) {
  const row = whoRow({
    face: thread.title.slice(0, 1).toUpperCase(),
    name: thread.title,
    note: thread.whereAt,
    receiving: state.receiving.kind === "thread" && state.receiving.id === thread.id,
    onPick: () => receive("thread", thread.id, thread.title, null, thread.locator),
  });
  row.classList.add("row-nested");
  return row;
}

function group(label) {
  const heading = document.createElement("p");
  heading.className = "row-group";
  heading.textContent = label;
  return heading;
}

function whoRow({ face, name, note, busy, receiving, onPick }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  row.setAttribute("aria-pressed", String(receiving));

  const avatar = document.createElement("span");
  avatar.className = "agent-avatar-dot";
  avatar.textContent = face;
  if (busy) avatar.dataset.busy = "true";

  const label = document.createElement("span");
  label.className = "agent-name";
  label.textContent = name;
  label.title = name;

  row.append(avatar, label);
  // "Receiving" wins over "Running": one is what this menu is for, the other is
  // background news, and two marks on one row would make neither readable.
  const said = receiving ? "Receiving" : note;
  if (said) {
    const tail = document.createElement("span");
    tail.className = "row-key";
    tail.textContent = said;
    row.append(tail);
  }
  row.addEventListener("click", onPick);
  return row;
}

function drawMarks() {
  const live = document.getElementById("live");
  const drawn = [];
  for (const mark of state.marks) {
    const kind = mark.tool === "draw" ? "stroke" : mark.region && mark.region.shape;
    if (!kind) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathFor({ kind, points: mark.points }));
    path.setAttribute(
      "fill",
      kind === "stroke" ? "none" : "color-mix(in srgb, var(--accent, #ff6b6b) 13%, transparent)",
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
  el.pins.replaceChildren(
    ...state.marks
      .filter((mark) => mark.tool === "pointAt")
      .map((mark) => {
        const pin = document.createElement("span");
        pin.className = "pin";
        pin.style.left = `${mark.points[0].x * 100}%`;
        pin.style.top = `${mark.points[0].y * 100}%`;
        pin.textContent = String(++number);
        return pin;
      }),
  );
}

function drawReceipt() {
  const said = state.receipt;
  el.receipt.hidden = !said;
  if (!said) return;
  el.receipt.dataset.blocked = String(said.blocked);
  el.receipt.innerHTML =
    '<span class="receipt-dot">●</span>' +
    `<span class="receipt-did"></span><span>→</span><span class="receipt-through"></span>` +
    // Named, not just appended: a receiver used to be one word and read as part of the
    // surface beside it. A conversation's title is a sentence, and "Openclaw Desktop
    // Kitchen rebuild quotes" is not a sentence about anything.
    (said.agent ? '<span class="receipt-to">· to</span><span class="receipt-agent"></span>' : "");
  el.receipt.querySelector(".receipt-did").textContent = said.did;
  el.receipt.querySelector(".receipt-through").textContent = said.through;
  if (said.agent) el.receipt.querySelector(".receipt-agent").textContent = said.agent;
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
  const rects =
    state.tool !== "pointer"
      ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]
      : [boxAround(el.wrap)];
  if (state.popup !== null && !el.popup.hidden) rects.push(boxAround(el.popup));
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
 * nothing to say: the rail is drawn, and nothing responds. The receipt line is already
 * the place this surface tells the truth about itself, so it says this too.
 */
function sayFailed(message) {
  // Also the window title, which survives a page that cannot draw and is readable from
  // outside the app while this is being worked on.
  document.title = `toolbar error: ${message}`;
  state.receipt = {
    did: "The toolbar hit an error",
    through: message,
    agent: null,
    blocked: true,
  };
  try {
    drawReceipt();
  } catch {
    // Nothing left to do: if drawing the message also throws, saying so louder will not
    // help, and throwing from an error handler loses the original.
  }
}

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
  recall();
  place();

  try {
    const front = await invoke("colai_frontmost");
    // No connector until the surface registry exists. Stated rather than implied: this
    // is what a write is refused on, and defaulting it otherwise would make the refusal
    // meaningless.
    state.surface = front ? { app: front.app, connector: null } : null;
  } catch {
    state.surface = null;
  }

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
