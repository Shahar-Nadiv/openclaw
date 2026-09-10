// The toolbar: point at anything on screen and hand it to an agent.
//
// The decisions live in toolbar-tools.js, which knows nothing about a browser. This is
// the page: the rail, the gestures, and what gets drawn.

/* ── browser bindings ─────────────────────────────────────────────────────── */

const tauri = window["__TAURI__"];
const invoke = tauri ? tauri.core.invoke : async () => undefined;
const listen = tauri ? tauri.event.listen : async () => () => {};

const WHERE = "openclaw.toolbar.where";

const el = {
  wrap: document.getElementById("rail-wrap"),
  rail: document.getElementById("rail"),
  grip: document.getElementById("grip"),
  flyShape: document.getElementById("fly-shape"),
  flyDesign: document.getElementById("fly-design"),
  flyGit: document.getElementById("fly-git"),
  flyRecord: document.getElementById("fly-record"),
  flyDraw: document.getElementById("fly-draw"),
  flyRow: document.getElementById("fly-row"),
  flyPoints: document.getElementById("fly-points"),
  library: document.getElementById("library"),
  work: document.getElementById("work"),
  toasts: document.getElementById("toasts"),
  flights: document.getElementById("flights"),
  flyHow: document.getElementById("fly-how"),
  flyAutomate: document.getElementById("fly-automate"),
  flyAgents: document.getElementById("fly-agents"),
  agentRows: document.getElementById("agent-rows"),
  trouble: document.getElementById("trouble"),
  marks: document.getElementById("marks"),
  pins: document.getElementById("pins"),
  recording: document.getElementById("recording"),
  recordingArea: document.getElementById("recording-area"),
  recordingLeft: document.getElementById("recording-left"),
  capture: document.getElementById("capture"),
  popup: document.getElementById("popup"),

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
  // The automation being written, while the panel is open. Started from its own
  // defaults each time rather than kept: a schedule is about one piece of work, and
  // yesterday's interval sitting in the box is a job somebody creates by accident.
  cron: { ...AUTOMATION_FIRST },
  // Which conversation the row menu is about, and what it found to go back to.
  rowMenu: null,
  points: null,
  // What this connection is allowed to do, as the Gateway itself reported it. Empty
  // until the handshake, and empty is not "everything".
  allowed: [],
  // The session key a thread got when it was adopted, so it can be gone back through.
  adoptedKeys: {},
  // The runs the toolbar believes are underway: one per session it has sent to and not
  // yet heard the end of. Kept as a list rather than a flag, because "one agent is
  // working" and "four are" are different things to be told.
  runs: [],
  // The library window, while it is open, and which mark it will answer.
  library: null,
  // The Work window: what is waiting, what has been sent, and whether marks are drawn.
  work: { open: false, filter: "all" },
  // What has been sent, newest first. Kept for the session — surviving a restart is a
  // store, and a store is decided on purpose rather than in passing.
  history: [],
  // What is on screen saying an answer arrived. Empty nearly always.
  toasts: [],
  // The window somebody is looking at, as the watcher last reported it. Null until it
  // has spoken, which is a reason to leave every mark alone rather than to hide them —
  // a window with an empty id is the other thing, and means nothing is in front.
  front: null,
  // The catalogues this build knows how to read, so the library window can say which.
  libraries: [],
  // What every agent on this Gateway is doing, which is not the same question as what
  // this toolbar started. Null until the Gateway has answered once: no light is the
  // honest state before anything is known, and a green one would be a claim.
  atWork: null,
  // Windows that were asked what they are showing and had nothing to say. Asking again
  // is a quarter of a second spent learning what the last answer already said.
  mute: new Set(),
  // Which pen the drawing tool draws with. Chosen from the menu the key opens.
  pen: PEN_FIRST,
  // Which kind of design the next design mark asks for. Chosen on the menu, and
  // changeable on the mark itself afterwards.
  designKind: DESIGN_FIRST,
  // Which git command the next git mark is asking for. Chosen on the menu, and
  // changeable on the mark afterwards, exactly as the design kind is.
  gitKind: GIT_FIRST,
  // How the next send should be answered. Both are settings on the conversation rather
  // than fields on a message, so they are applied to whoever receives it — and they
  // stick, because somebody who picked a model meant it for more than one send.
  model: null,
  effort: null,
  // The catalogue, asked for when the picker opens rather than kept warm.
  models: null,
  modelsTrouble: null,
  // Whether the exact tools are folded shut. Open to begin with — the rail is what
  // this toolbar is, and a first look at it should be the whole thing. Remembered with
  // the dock, because it is the same kind of fact: how somebody wants this to sit.
  tucked: false,
  // Whether the whole rail is put away: the grip and the claw, and nothing else.
  //
  // A second, deeper fold than `tucked`. That one hides four tools somebody rarely
  // reaches for; this one is for when the toolbar should stop being furniture on a
  // screen being worked on. The claw stays because it is the way back and because it
  // already carries the mood — a rail that is away can still say something needs you.
  away: false,
  // Whether the receiver was chosen rather than worked out. A guess may fill an empty
  // seat; it may never take one somebody has sat in.
  picked: false,
  // The project the window in front belongs to, when that is obvious.
  inFront: null,
  // What the next send is for, and anything else somebody wants to say with it.
  mode: MODE_FIRST,
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
          state.tool === "design" || state.tool === "screenshot" || state.open === "design",
        ),
      );
      button.title =
        state.tool === "design"
          ? `Design · ${(DESIGNS[state.designKind] || DESIGNS[DESIGN_FIRST]).label}`
          : "Design";
    } else if (id === "git") {
      button.setAttribute(
        "aria-pressed",
        String(state.tool === "git" || state.open === "git"),
      );
      // Which of the six is in your hand, because the key looks the same for all of
      // them and a rebase is not a thing to find out about by doing it.
      button.title =
        state.tool === "git" ? `Git · ${GITS[gitKindOf({ git: state.gitKind })].label}` : "Git";
    } else if (id === "agents") {
      button.setAttribute("aria-pressed", String(state.open === "agents"));
    } else if (id === "send") {
      button.setAttribute("aria-pressed", String(state.open === "send"));
    } else if (id === "exact") {
      // Lit while the tool in your hand is one of the folded ones, because a folded
      // rail has no other way of saying which tool is out.
      button.setAttribute(
        "aria-pressed",
        String(state.tucked && EXACT.includes(state.tool)),
      );
      button.title = state.tucked ? "Show measure, colour, record…" : "Fold these away";
      button.setAttribute("aria-expanded", String(!state.tucked));
      // One mark that turns says "this opens and closes". Two different marks would say
      // "these are two different buttons".
      button.dataset.turn = String(!state.tucked);
    } else if (id === "draw") {
      button.setAttribute("aria-pressed", String(state.tool === "draw" || state.open === "draw"));
      button.title = `Draw · ${(PENS[state.pen] || PENS[PEN_FIRST]).label} · D`;
    } else if (id === "record") {
      button.setAttribute("aria-pressed", String(state.tool === "record" || state.open === "record"));
      button.title = `Record ${state.recordFor} seconds · R`;
    } else if (TOOLS[id]) {
      button.setAttribute("aria-pressed", String(state.tool === id));
    }
  }
  buttons.undo.disabled = state.marks.length === 0;
  buttons.redo.disabled = state.undone.length === 0;

  // What is actually still running, rather than what was last started. A run that has
  // gone quiet for minutes is one the toolbar has lost track of, and claiming it is
  // still working is a worse lie than never having said so.
  state.runs = runsNow(state.runs, state.atWork, Date.now());
  const working = runningSaid(state.runs);
  buttons.agents.dataset.working = String(state.runs.length > 0);
  buttons.stop.hidden = state.runs.length === 0;
  buttons.stop.title = state.runs.length === 1 ? "Stop the agent" : `Stop ${state.runs.length} runs`;

  // The mascot carries what the whole Gateway is doing, including the agents somebody
  // is not looking at. `data-mood` rather than a class, so the stylesheet holds the one
  // table of what each state looks like and this holds none of it.
  // Removed rather than emptied. The stylesheet pulses on `[data-mood]` being *there*,
  // so an empty one is still a mood as far as CSS is concerned — and left the glow
  // breathing over a desktop where nothing at all was happening.
  const mood = moodMark(state.atWork);
  if (mood) buttons.settings.dataset.mood = mood;
  else delete buttons.settings.dataset.mood;
  // The one trigger for the gait, wherever the crab is drawn. Working is the only mood
  // it walks in: a crab scuttling under a red light would be the toolbar contradicting
  // itself.
  buttons.settings.dataset.walking = String(mood === "working");
  buttons.settings.title = moodSaid(state.atWork);
  buttons.settings.setAttribute("aria-label", buttons.settings.title);

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
    : working ||
      counted(state.agents.length, "agent") +
        (talking() ? ` · ${counted(talking(), "conversation")}` : "");

  // Which kind each tool that has kinds is currently set to. One rule rather than a
  // special case per tool: several rows share a tool and differ only in what they ask it
  // for, so "is this the current tool" lights all of them — which it did for git, where
  // choosing Stage lit Commit, Push and Rebase alongside it.
  const kindNow = { design: state.designKind, git: state.gitKind };
  for (const button of document.querySelectorAll(".row[data-tool]")) {
    const chosen =
      button.dataset.tool === state.tool &&
      (!button.dataset.kind || button.dataset.kind === kindNow[button.dataset.tool]);
    button.setAttribute("aria-pressed", String(chosen));
  }

  const waiting = chosenMarks().length;
  buttons.send.querySelector(".send-many").textContent = waiting ? String(waiting) : "";
  buttons.send.dataset.waiting = String(waiting > 0);

  el.flyShape.hidden = state.open !== "shape";
  el.flyDesign.hidden = state.open !== "design";
  el.flyGit.hidden = state.open !== "git";
  el.flyHow.hidden = state.open !== "how";
  el.flyAutomate.hidden = state.open !== "automate";
  // Folded, the six close up where they stand rather than vanishing — the stylesheet
  // animates it and `data-folded` is what it animates between. Not `hidden`: a key that
  // disappears takes two hundred pixels of rail with it in one frame, and a toolbar
  // that changes length between two blinks reads as a glitch, not as a thing that
  // folded.
  //
  // Two reasons a key can be shut: the exact tools are tucked, or the whole rail is
  // away. The same closing, because it is the same gesture at two depths — and reusing
  // it means an away rail collapses with the animation this already got right rather
  // than a second one that would have to agree with it.
  for (const [id, button] of Object.entries(buttons)) {
    if (id === "settings") continue;
    button.dataset.folded = String(state.away || (EXACT.includes(id) && state.tucked));
  }
  el.wrap.dataset.away = String(state.away);
  // What the handle says it will do next, and what a screen reader is told the rail is.
  el.grip.setAttribute("aria-expanded", String(!state.away));
  el.grip.title = state.away
    ? "Drag toolbar · double click to bring it back"
    : "Drag toolbar · double click to put it away";
  if (state.open === "automate") drawAutomation();
  el.flyRow.hidden = state.open !== "row";
  el.flyPoints.hidden = state.open !== "points";
  if (state.open === "row") drawRowMenu();
  if (state.open === "points") drawPoints();
  el.flyDraw.hidden = state.open !== "draw";
  for (const button of el.flyDraw.children) {
    button.setAttribute("aria-pressed", String(button.dataset.pen === state.pen));
  }
  el.flyRecord.hidden = state.open !== "record";
  for (const button of el.flyRecord.children) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === state.recordFor));
  }
  el.flyAgents.hidden = state.open !== "agents";

  // Filled before it is placed. A menu is measured to decide whether it fits on the
  // screen, and measuring it empty answers a question about a different menu — which is
  // how a full list of conversations came to hang off the bottom of the display while
  // the same code, run again a moment later, put it back.

  if (state.open === "agents") drawWho();
  // The Work panel is a menu like the others and obeys the same rule. It did not: it was
  // placed here and filled below, so `within` measured whatever it held last time. A
  // panel opened with six exchanges in it was fitted to the screen as though it still
  // held none, and hung two hundred pixels off the bottom of the display.
  drawWork();
  // Under the key that opened it, measured rather than guessed. Four hand-tuned
  // offsets used to stand here, and they were four chances to drift: adding the record
  // key pushed everything to its right along and left the design menu opening under a
  // key three along from the one that owns it.
  for (const [node, anchor] of [
    [el.flyShape, buttons.shape],
    [el.flyDesign, buttons.design],
    [el.flyGit, buttons.git],
    [el.flyRecord, buttons.record],
    [el.flyDraw, buttons.draw],
    [el.flyRow, buttons.agents],
    [el.flyPoints, buttons.agents],
    [el.flyHow, buttons.send],
    [el.flyAutomate, buttons.send],

    [el.flyAgents, buttons.agents],
    // The work panel hangs off send, the key that opens it.
    [el.work, buttons.send],
  ]) {
    placeFlyout(node, vertical, vertical ? anchor.offsetTop : anchor.offsetLeft);
  }

  drawMarks();
  drawPopup();
  drawLibrary();
  drawToasts();
  drawTrouble();
  // Left mounted while a popup is open, which is how a click off the popup is heard at
  // all — the popup is stacked above it, so its own controls still get their clicks.
  el.capture.hidden = state.tool === "pointer";
  shape();
}

/**
 * Redraw the marks on the next frame, however many answers arrived before it.
 *
 * The watcher looks faster than the screen refreshes while a window is being dragged, on
 * purpose — a mark that updates on its own slower clock trails the window it is drawn on.
 * But drawing once per answer would mean drawing several times over for one frame nobody
 * sees, so the answers are kept and the drawing happens once, at the rate the display
 * actually has.
 */
let redrawing = 0;
function redrawMarksSoon() {
  if (redrawing) return;
  redrawing = requestAnimationFrame(() => {
    redrawing = 0;
    drawMarks();
    // Almost always a no-op: the marks are not part of the clickable region, and this is
    // memoised on the rectangles so it only crosses to Rust when they genuinely differ.
    // Left in because a popup open over a moving window is not a no-op.
    shape();
  });
}

/**
 * The line by the rail about the last thing that happened, and its way out.
 *
 * It had none. "Stopped main." was set, drawn, and then sat beside the toolbar for the
 * rest of the session — every message here is about a moment, and none of them said so.
 * A banner that outlives the thing it is about stops being read at all.
 *
 * Timed from the words rather than from the render, because this runs on every frame and
 * restarting the clock each time would mean it never ran out.
 */
let saidLast = "";
let fadingTrouble = null;
function drawTrouble() {
  const said = state.trouble || "";
  el.trouble.hidden = !said;
  el.trouble.textContent = said;
  if (said === saidLast) return;
  saidLast = said;
  if (fadingTrouble !== null) clearTimeout(fadingTrouble);
  fadingTrouble = said
    ? setTimeout(() => {
        state.trouble = null;
        render();
      }, TOAST_FOR)
    : null;
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
  if (state.library !== null && !el.library.hidden) rects.push(boxAround(el.library));
  if (state.work.open && !el.work.hidden) rects.push(boxAround(el.work));
  if (state.toasts.length && !el.toasts.hidden) rects.push(boxAround(el.toasts));
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

/** Start listening for the single letters that pick a tool, and the ways out. */
function listenForKeys() {
  window.addEventListener("keydown", onKey);
}

function onKey(event) {
  // The library first: it opens over the popup and closes back to it, so Escape there
  // means "not this one" rather than "throw the mark away".
  if (event.key === "Escape" && state.library !== null) {
    closeLibrary();
    return;
  }
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
}

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
function listenForDrops() {
  listen("tauri://drag-enter", (event) => {
    state.catching = onTheToolbar(event);
    render();
  });
  listen("tauri://drag-leave", () => {
    state.catching = false;
    render();
  });
  listen("tauri://drag-drop", onDrop);
}

async function onDrop(event) {
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
}

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
  // Everything this page listens to, started here rather than while its scripts load.
  // A registration that runs at load makes the order of the script tags into a
  // dependency nobody can see; this way each file is a bag of declarations and the
  // page decides when it comes alive.
  listenForMarking();
  listenForKeys();
  listenForDrops();
  listenForDrag();
  recall();
  place();

  await learnFront();

  // Answers, as they arrive. A session says a great deal — the question going in, the
  // work coming out — and only what an agent finally said back is an answer to what was
  // pointed at.
  // A run saying it is over, or has fallen over.
  // Which window is in front. Asked once, then listened for.
  //
  // Both halves are needed. The watcher only speaks when the answer changes, and the
  // first change it sees is at startup — before this page exists to hear it. Waiting for
  // the second one meant a toolbar opened onto a desktop nobody then switched away from
  // never learned which window was in front, so every mark stayed pinned to the screen
  // exactly as it had before any of this was written.
  void invoke("colai_in_front")
    .then((front) => {
      // Only if nothing has been heard since: an event that arrived while this was in
      // flight is newer than this answer.
      if (state.front === null) state.front = front || null;
      render();
    })
    .catch(() => {});

  void listen("colai:front", (event) => {
    state.front = (event && event.payload) || null;
    redrawMarksSoon();
  }).catch(() => {});


  void listen("colai:reply", (event) => {
    const payload = event && event.payload;
    if (!payload) return;
    // Anything said is a sign of life, which is what keeps the glow from timing out on
    // an agent that is working but slow.
    const run = state.runs.find((one) => one.sessionKey === payload.sessionKey);
    if (run) run.heard = Date.now();
    // The pin for that session, whether or not it has heard something already. It used
    // to stop looking once anything had arrived, which threw away everything after the
    // first turn — and an agent says what it is doing before it says what it found.
    const waiting = state.answers.find((answer) => answer.sessionKey === payload.sessionKey);
    if (!waiting) return;
    const said = spokenBy(payload.message);
    if (!said) return;
    const turns = waiting.turns || [];
    // The same turn can arrive twice on a reconnect, and a pin that repeats itself reads
    // as an agent that repeated itself.
    if (turns.some((turn) => !turn.mine && turn.said === said)) return;
    // The first thing back is the thing worth interrupting somebody for. An agent says
    // what it is doing before it says what it found, and one send that talks four times
    // is one thing that happened.
    const spoken = turns.some((turn) => !turn.mine);
    waiting.turns = [...turns, { said, mine: false }];
    if (!spoken) raiseToast(waiting, said);
    render();
  }).catch(() => {});

  void loadWho();
  // And what every agent is doing, from now until the window closes.
  void watchEverything();
  setInterval(() => void watchEverything(), WATCH_EVERY);
  // The Gateway connects a moment after the app does, so the first ask usually lands
  // before there is anything to answer it. Asked again rather than leaving the rail
  // saying "unavailable" until somebody happens to open the menu.
  for (const wait of [1500, 4000, 9000]) {
    setTimeout(() => {
      // Or while this machine still has no idea what it is allowed to do. The two
      // usually fail together — nothing answers before the handshake — but tying the
      // retry to only one of them makes that coincidence load-bearing, and the menu
      // that depends on the other spends the session refusing.
      if (state.whoTrouble || state.allowed.length === 0) void loadWho();
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
