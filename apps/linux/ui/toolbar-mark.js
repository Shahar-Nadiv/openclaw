// Making a mark, and turning it into a picture.
//
// The gesture, what it produces, and the photograph taken of it — one path from a hand
// on the glass to an image an agent can be given. Kept together because they are one
// motion: the shape somebody drags decides what is cropped, and the crop is what the
// mark turns out to have meant.
//
// Nothing here listens while the file loads. `listenForMarking` is called from the
// page's own `start`, so the order of the script tags is not a dependency anybody has
// to know about.

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

/**
 * Start listening for the gesture that makes a mark.
 *
 * Registered from `start` rather than while this file loads, so nothing here depends on
 * the order the page's scripts happen to be in — the same reason the dock listens the
 * way it does, and what lets this half of the toolbar live in a file of its own.
 */
function listenForMarking() {
  el.capture.addEventListener("pointerdown", startGesture);
  el.capture.addEventListener("pointermove", extendGesture);
  el.capture.addEventListener("pointerup", release);
  el.capture.addEventListener("pointercancel", release);
}

function startGesture(event) {
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
}

function extendGesture(event) {
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
}

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
  // A design mark starts as a wireframe with the kind's own home in it. Somebody can
  // change both in the popup; starting empty would mean typing a path they had no
  // reason to know before they could ask for the commonest thing on the menu.
  if (mark.tool === "design") {
    mark.design = DESIGN_FIRST;
    mark.dest = DESIGNS[DESIGN_FIRST].home;
  }
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
