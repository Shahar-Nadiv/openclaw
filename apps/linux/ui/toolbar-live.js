// The two things this toolbar does while nobody is pressing anything.
//
// A recording runs for its length; a watch runs until something moves or until it gives
// up. Both draw on the screen the whole time they are running, and both draw *outside*
// the pixels their pictures are taken from — a toolbar that photographed its own marker
// would be answering a question about itself.
//
// They are together because that rule is the interesting thing about either of them,
// and it is one rule: `recordFrame` decides the clearance for both, against a number
// read out of the capture code that enforces it.

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

function listenForWatches() {
  listen("colai:watch-changed", (event) => void watchFired(event.payload.markId));
  listen("colai:watch-ended", onWatchEnded);
}

function onWatchEnded(event) {
  const { markId, why, says } = event.payload;
  void stopWatching(markId, false);
  // "stopped" is somebody pressing the badge; they know. The rest is the toolbar
  // giving up, which nobody asked for and everybody should be told about.
  if (why === "stopped") return;
  state.trouble = says
    ? `Stopped watching that region — ${says}.`
    : "Stopped watching that region.";
  render();
}
