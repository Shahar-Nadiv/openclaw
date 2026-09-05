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
 */
const TOOLS = {
  pointer: { label: "Pointer", press: "V", glyph: "pointer", writes: false },
  pointAt: { label: "Point at", press: "P", glyph: "pointAt", writes: false },
  draw: { label: "Draw", press: "D", glyph: "draw", writes: false },
  box: { label: "Box", press: "B", glyph: "box", writes: false },
  circle: { label: "Circle", press: "O", glyph: "circle", writes: false },
  wireframe: { label: "Create wireframe", glyph: "wireframe", writes: true },
  screenshot: { label: "Screenshot", glyph: "screenshot", writes: false },
};

/** What each tool draws while it is being dragged, if anything. */
const DRAWS = { box: "box", circle: "ellipse", draw: "stroke" };

/** Single letters that pick a tool, from the tooltips the rail shows. */
const KEYS = { v: "pointer", p: "pointAt", d: "draw", b: "box", o: "circle" };

/**
 * How close to an edge counts as docked.
 *
 * Wide enough that somebody aiming for the edge hits it, narrow enough that a rail
 * parked near the side is not dragged into an orientation change it was not asked for.
 */
const DOCK_WITHIN = 80;
/** How far a docked rail sits from the edge of the room it has. */
const EDGE = 14;

const NOTHING_RESERVED = { top: 0, right: 0, bottom: 0, left: 0 };

function isVertical(dock) {
  return dock === "left" || dock === "right";
}

/**
 * The part of the screen the toolbar may use.
 *
 * Not the whole screen. A desktop's own panels — GNOME's top bar, Ubuntu's dock — are
 * drawn by the compositor above every window, so a toolbar docked flush to a screen edge
 * disappears underneath one. Keeping out of them is the only arrangement where both stay
 * visible.
 */
function usable(screen, reserved) {
  const edges = reserved || NOTHING_RESERVED;
  return {
    left: edges.left,
    top: edges.top,
    right: screen.width - edges.right,
    bottom: screen.height - edges.bottom,
  };
}

function dockFor(box, screen, reserved) {
  const room = usable(screen, reserved);
  if (box.x - room.left < DOCK_WITHIN) return "left";
  if (room.right - (box.x + box.width) < DOCK_WITHIN) return "right";
  if (box.y - room.top < DOCK_WITHIN) return "top";
  if (room.bottom - (box.y + box.height) < DOCK_WITHIN) return "bottom";
  return null;
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
};

const state = {
  tool: "pointer",
  dock: null,
  at: null,
  open: null,
  surface: null,
  reserved: NOTHING_RESERVED,
  agents: [],
  // Null while the list is good, a message while the Gateway could not be asked. The
  // two are different facts and the rail says which.
  agentsTrouble: null,
  receivingId: null,
  marks: [],
  undone: [],
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

  const gear = key("settings", "Settings · ⌘,", "settings", () =>
    invoke("colai_open_settings"),
  );
  dividers[2].after(agents, gear);

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
  const who = state.agents.find((agent) => agent.id === state.receivingId);
  state.receipt = receiptFor(tool, state.surface, who ? who.name : null);
  render();
}

function flyout(which) {
  state.open = state.open === which ? null : which;
  render();
  // Asked when the menu opens rather than polled: the answer only matters when somebody
  // is looking at it, and the Gateway caches the list anyway.
  if (state.open === "agents") void loadAgents();
}

/**
 * Who this machine can hand a region to.
 *
 * The application's own agent list, not a second idea of one — the toolbar should never
 * disagree with the window behind it about what is running. A failure leaves the list
 * alone and says so on the rail rather than emptying it, because "no agents" and "could
 * not ask" are different facts and only one of them is the user's problem.
 */
async function loadAgents() {
  try {
    state.agents = (await invoke("colai_agents", { receiving: state.receivingId })) || [];
    const receiving = state.agents.find((agent) => agent.receiving);
    if (receiving) state.receivingId = receiving.id;
    state.agentsTrouble = null;
  } catch (error) {
    state.agentsTrouble = error && error.message ? error.message : String(error);
  }
  render();
}

function receive(id) {
  state.receivingId = id;
  state.open = null;
  void loadAgents();
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
  if (finished.kind !== "stroke" && box.w < 0.004 && box.h < 0.004) return;

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
  state.marks.push(mark);
  // A new mark ends the redo trail: what was undone is no longer what comes next.
  state.undone = [];
  render();
}

/* ── where the rail sits ─────────────────────────────────────────────────── */

el.grip.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const box = el.wrap.getBoundingClientRect();
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const room = usable(screen, state.reserved);
  let grabX = event.clientX - box.left;
  let grabY = event.clientY - box.top;
  let edge = state.dock;
  let last = { x: box.left, y: box.top };

  const move = (moved) => {
    const size = el.wrap.getBoundingClientRect();
    const x = Math.max(room.left, Math.min(room.right - size.width, moved.clientX - grabX));
    const y = Math.max(room.top, Math.min(room.bottom - size.height, moved.clientY - grabY));
    const now = dockFor({ x, y, width: size.width, height: size.height }, screen, state.reserved);
    if (now !== edge) {
      // A rail that was 420 wide and becomes 44 wide has no sensible relationship to
      // where the hand was on it; re-grabbing near the corner is what keeps it on screen.
      if (isVertical(now) !== isVertical(edge)) {
        grabX = 20;
        grabY = 20;
      }
      edge = now;
      state.dock = now;
      state.open = null;
      render();
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
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const room = usable(screen, state.reserved);
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
  const room = usable({ width: window.innerWidth, height: window.innerHeight }, state.reserved);
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
    } else if (TOOLS[id]) {
      button.setAttribute("aria-pressed", String(state.tool === id));
    }
  }
  buttons.undo.disabled = state.marks.length === 0;
  buttons.redo.disabled = state.undone.length === 0;

  const who = state.agents.find((agent) => agent.id === state.receivingId);
  const mark = buttons.agents.querySelector(".running-dots");
  mark.textContent = who && who.emoji ? who.emoji : "";
  buttons.agents.querySelector(".agents-who").textContent = who
    ? who.name
    : state.agents.length
      ? "Choose an agent"
      : "Agents";
  buttons.agents.querySelector(".agents-running").textContent = state.agentsTrouble
    ? "unavailable"
    : `${state.agents.length} available`;

  for (const button of document.querySelectorAll(".row[data-tool]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
  }

  el.flyShape.hidden = state.open !== "shape";
  el.flyDesign.hidden = state.open !== "design";
  el.flyAgents.hidden = state.open !== "agents";
  for (const [node, from] of [
    [el.flyShape, 150],
    [el.flyDesign, 190],
    [el.flyAgents, 230],
  ]) {
    placeFlyout(node, vertical, from);
  }
  if (state.open === "agents") drawAgents();

  drawMarks();
  drawReceipt();
  el.capture.hidden = state.tool === "pointer";
  shape();
}

function placeFlyout(node, vertical, from) {
  node.style.cssText = "";
  if (vertical) {
    node.style.top = `${from}px`;
    node.style[state.dock === "right" ? "right" : "left"] = "calc(100% + 10px)";
  } else {
    node.style.left = `${from}px`;
    node.style[state.dock === "top" ? "top" : "bottom"] = "calc(100% + 8px)";
  }
}

/**
 * The agent list, as rows somebody picks from.
 *
 * Three states and they are genuinely different: could not ask, nothing there, and a
 * list. Collapsing the first two into "no agents" would blame the person for a Gateway
 * that is not answering.
 */
function drawAgents() {
  if (state.agentsTrouble) {
    const said = document.createElement("p");
    said.className = "agent-empty";
    said.textContent = `Could not reach the Gateway — ${state.agentsTrouble}`;
    el.agentRows.replaceChildren(said);
    return;
  }
  if (state.agents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "agent-empty";
    empty.textContent = "No agents yet. Add one in the OpenClaw window and it appears here.";
    el.agentRows.replaceChildren(empty);
    return;
  }

  el.agentRows.replaceChildren(
    ...state.agents.map((agent) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "row";
      row.setAttribute("aria-pressed", String(agent.id === state.receivingId));

      const avatar = document.createElement("span");
      avatar.className = "agent-avatar-dot";
      avatar.textContent = agent.emoji || agent.name.slice(0, 1).toUpperCase();

      const name = document.createElement("span");
      name.className = "agent-name";
      name.textContent = agent.name;

      row.append(avatar, name);
      if (agent.id === state.receivingId) {
        const receiving = document.createElement("span");
        receiving.className = "row-key";
        receiving.textContent = "Receiving";
        row.append(receiving);
      }
      row.addEventListener("click", () => receive(agent.id));
      return row;
    }),
  );
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
    (said.agent ? '<span class="receipt-agent"></span>' : "");
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
  const rects =
    state.tool !== "pointer"
      ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]
      : [boxAround(el.wrap)];
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
  for (const child of node.querySelectorAll("*")) {
    const box = child.getBoundingClientRect();
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
    state.reserved = (await invoke("colai_reserved")) || NOTHING_RESERVED;
  } catch {
    state.reserved = NOTHING_RESERVED;
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

  void loadAgents();
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
