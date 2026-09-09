// Where the rail sits, and how it turns.
//
// Dragging it, deciding which screen edge it is claiming, and dissolving between flat
// and upright. Apart from the page because it is geometry and animation rather than
// anything about marks or agents.

/* ── where the rail sits ─────────────────────────────────────────────────── */

/**
 * Listen for somebody picking the rail up.
 *
 * Registered from `start` rather than when this file loads, so the scripts can be
 * ordered by what reads best rather than by which one happens to touch the page first.
 */
function listenForDrag() {
    el.grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const box = railBox();
    let grabX = event.clientX - box.left;
    let grabY = event.clientY - box.top;
    let edge = state.dock;
    let last = { x: box.left, y: box.top };

    const move = (moved) => {
      const size = railBox();
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
      const size = railBox();
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
}

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
  const wrap = railBox();
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
    window.localStorage.setItem(
      WHERE,
      JSON.stringify({
        ...state.at,
        dock: state.dock,
        tucked: state.tucked,
      }),
    );
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
      // Only an explicit `true` folds them. A toolbar remembered from before this
      // existed has no opinion, and open is what somebody who has not said should get.
      state.tucked = put.tucked === true;
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
/**
 * How big the rail is — the bar itself, not everything hanging off it.
 *
 * The wrapper used to be the same thing, and every measurement here took it. Then the
 * work panel moved inside the wrapper to travel with the toolbar, and the wrapper became
 * four hundred pixels wide and eight hundred tall. Every rule that holds the rail on
 * screen was suddenly holding a panel-sized object: opening the panel shoved the rail
 * across the display, and folding it away shoved it back.
 *
 * Placement asks about the rail. What may be clicked is a different question, and
 * `boxAround(el.wrap)` is still the right answer to that one — the panel is clickable.
 */
function railBox() {
  return el.rail.getBoundingClientRect();
}

function clamp() {
  if (!state.at) return;
  const size = railBox();
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
