// The toolbar: point at anything on screen and hand it to an agent.
//
// The decisions live in toolbar-tools.js, which knows nothing about a browser. This is
// the page: the rail, the gestures, and what gets drawn.

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
  measure: '<path d="M4 6v12M20 6v12M4 12h16"/><path d="M8.5 9l-3 3 3 3M15.5 9l3 3-3 3"/>',
  colour:
    '<path d="M12 3.5s6 6.4 6 10.1a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/><path d="M8.6 14.4a3.4 3.4 0 0 0 3.4 3.2"/>',
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
  trouble: document.getElementById("trouble"),
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

  const exact = document.createDocumentFragment();
  exact.append(
    key("measure", "Measure · M", "measure", () => use("measure")),
    key("colour", "Colour · C", "colour", () => use("colour")),
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
async function shoot(mark) {
  document.body.style.visibility = "hidden";
  try {
    await new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)));
    await new Promise((waited) => setTimeout(waited, 40));
    const taken = await invoke("colai_capture_mark", { mark, accent: accentNow() });
    if (taken.hex) mark.hex = taken.hex;
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
