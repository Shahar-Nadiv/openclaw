// Where the work lives, once it has stopped living on somebody's screen.
//
// The toolbar used to put everything on the desktop: the marks while you composed, the
// answer pins afterwards. That was right when a mark was one question asked and
// answered. It stopped being right once you could make four marks, send them, get a
// reply and go back to an earlier prompt — because by then there is a body of work, and
// the only place it lived was scattered over whatever somebody was actually doing.
//
// So the screen goes quiet and this holds it: what is waiting, what has been sent, what
// came back, and the way back to an earlier prompt. One window, because the whole
// complaint was that it was in several places at once.

/**
 * Open it, close it, or the other one.
 *
 * The send key opens this rather than a flyout. There is one place where work is
 * assembled, and a second place to assemble it in would be the thing this replaces.
 */
function toggleWork() {
  state.work.open = !state.work.open;
  if (state.work.open) state.open = null;
  render();
}

function closeWork() {
  state.work.open = false;
  render();
}

function openWork() {
  state.work.open = true;
  state.open = null;
  render();
}

function drawWork() {
  const open = state.work.open;
  el.work.hidden = !open;
  if (!open) return;

  const head = document.createElement("div");
  head.className = "work-head";
  // The head is the handle. A window meant to stay open all day has to be movable, and
  // the bar with its name on it is where everything else on this desktop is picked up.
  head.addEventListener("pointerdown", startWorkDrag);
  const title = document.createElement("p");
  title.className = "work-title";
  title.textContent = "Work";
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "popup-shut";
  shut.title = "Close";
  shut.setAttribute("aria-label", "Close the work window");
  shut.textContent = "×";
  shut.addEventListener("click", closeWork);
  head.append(title, shut);

  // What is waiting to be sent. The composer, in the one place work is assembled rather
  // than in a flyout of its own — it is the same panel, re-parented.
  const waiting = document.createElement("div");
  waiting.className = "work-waiting";
  drawComposer(waiting);

  const past = document.createElement("div");
  past.className = "work-history scrolls";
  if (state.history.length === 0) {
    past.append(saying("Nothing sent yet. What you send will be kept here."));
  } else {
    const now = Date.now();
    for (const entry of state.history) past.append(entryRow(entry, now));
  }

  // A setting, at the foot, where a setting goes. Marks are drawn while a tool is out
  // and not otherwise; this is for looking at what is waiting without picking a tool up.
  const foot = document.createElement("label");
  foot.className = "work-foot";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.className = "mark-tick";
  tick.checked = Boolean(state.work.showing);
  tick.addEventListener("change", () => {
    state.work.showing = tick.checked;
    // Kept with where the rail sits: both are how somebody set this up, not what they
    // are doing with it.
    remember();
    render();
  });
  const said = document.createElement("span");
  said.textContent = "Show marks on screen";
  foot.append(tick, said);

  el.work.replaceChildren(head, waiting, past, foot);
  placeWork();
}

/** One thing that was sent, and whatever has come back about it. */
function entryRow(entry, now) {
  const row = document.createElement("div");
  row.className = "work-entry";

  const top = document.createElement("div");
  top.className = "work-entry-head";
  const who = document.createElement("span");
  who.className = "work-who";
  who.textContent = entry.who;
  const when = document.createElement("span");
  when.className = "row-under";
  when.textContent = agoSaid(entry.at, now);
  top.append(who, when);
  row.append(top);

  // The pictures of what went, which is what somebody recognises the send by — the words
  // beside them are often a note about a thing rather than a description of it.
  // Only when there are pictures. A row of empty grey squares reads as images that
  // failed to load, which is a worse thing to say than nothing.
  if (entry.shots.some(Boolean)) {
    const shots = document.createElement("div");
    shots.className = "work-shots";
    for (const shot of entry.shots) {
      const one = document.createElement("span");
      one.className = "mark-shot";
      if (shot) {
        const picture = document.createElement("img");
        picture.src = shot;
        picture.alt = "";
        one.append(picture);
      }
      shots.append(one);
    }
    row.append(shots);
  }

  const said = document.createElement("p");
  said.className = "work-said";
  said.textContent = entrySaid(entry);
  // Clamped for shape, so the whole of a long prompt has to stay reachable somehow.
  said.title = said.textContent;
  row.append(said);

  const answer = entry.answer;
  if (answer) {
    row.append(...answerRows(entry, answer));
  }

  // Rewind, beside the prompt it would take you back to — which is where it was always
  // wanted, rather than behind a right click on a list of conversations.
  const may = canGoBack({ kind: "session", id: entry.sessionKey, sessionKey: entry.sessionKey }, state.allowed);
  const rewind = document.createElement("button");
  rewind.type = "button";
  rewind.className = "row row-quiet work-rewind";
  rewind.disabled = !may.can || !entry.sessionKey;
  rewind.textContent = "Rewind…";
  rewind.title = may.why || "Go back to an earlier prompt you sent";
  rewind.addEventListener("click", () => {
    state.rowMenu = {
      kind: "session",
      id: entry.sessionKey,
      sessionKey: entry.sessionKey,
      name: entry.who,
    };
    void openPoints();
  });
  row.append(rewind);
  return row;
}

/**
 * What came back, and the way to say something to it.
 *
 * This used to be a panel hanging off a pin on the desktop. The pin is gone: once every
 * mark is in this window there is no reason for a second place to read a reply, and a
 * circle left on somebody's screen is the thing this whole change is about.
 *
 * Every turn, not the first. An agent says what it is doing before it says what it
 * found, and keeping only the first threw away the two that usually matter.
 */
function answerRows(entry, answer) {
  const rows = [];
  const turns = answer.turns || [];
  if (turns.length === 0) {
    const still = document.createElement("p");
    still.className = "work-waiting-on";
    still.textContent = `Waiting on ${entry.who}`;
    rows.push(still);
    return rows;
  }
  const said = document.createElement("div");
  said.className = "work-turns";
  for (const turn of turns) {
    const line = document.createElement("p");
    line.className = "answer-turn";
    line.dataset.mine = String(turn.mine === true);
    line.textContent = turn.said;
    said.append(line);
  }
  rows.push(said);

  // A reply in words, because most of what an agent says back is not a proposal to
  // accept or refuse. It asks which of two things you meant, or what a value should be —
  // and none of those have an answer that fits in two fixed buttons.
  const asking = asksSomething(lastTurn(answer) || "");
  const box = document.createElement("textarea");
  box.className = "popup-note answer-say";
  box.rows = 2;
  box.placeholder = asking ? "Answer them…" : "Say something back…";
  box.value = answer.saying_text || "";
  box.addEventListener("input", () => {
    answer.saying_text = box.value;
    render();
  });
  rows.push(box);

  const foot = document.createElement("div");
  foot.className = "popup-foot";
  // Still there, because "yes, go on" is the commonest answer in the world — but they
  // fill the box rather than being the only two things sayable.
  for (const [label, words, why] of [
    ["No", "Declined — that is not what I meant.", "Tell them this is not it"],
    ["Yes", "Accepted — go ahead.", "Tell them to go ahead"],
  ]) {
    const quick = document.createElement("button");
    quick.type = "button";
    quick.className = "popup-do answer-quick";
    quick.disabled = Boolean(answer.saying);
    quick.textContent = label;
    quick.title = why;
    quick.addEventListener("click", () => void verdict(answer, words));
    foot.append(quick);
  }
  const go = document.createElement("button");
  go.type = "button";
  go.className = "popup-do popup-go";
  go.disabled = Boolean(answer.saying) || !(answer.saying_text || "").trim();
  go.textContent = answer.saying ? "Sending…" : "Reply";
  go.addEventListener("click", () => void verdict(answer, answer.saying_text || ""));
  foot.append(go);
  rows.push(foot);
  return rows;
}

/**
 * A mark going where marks go.
 *
 * The screen is quiet now, which is what was asked for and which has one cost: a mark
 * that simply stops being drawn reads as a mark that was lost. So it visibly *goes*
 * somewhere — to the window when it is open, to the key that opens it when it is not —
 * and where it went is taught once, by watching, without a sentence about it.
 *
 * Decoration is not the point. This is the only thing standing between "my marks
 * disappeared" and knowing where they are.
 *
 * Painted, not caught: these are inert and last a third of a second, so they are left
 * out of the clickable region entirely rather than briefly claiming a strip of desktop.
 */
const FLIGHT = 380;

function flyToWork(marks) {
  // A desktop that asked for less movement is not told about this in motion; the marks
  // are in the window either way, and the window is one press from here.
  if (still() || typeof el.flights.animate !== "function") return;
  const going = marks.filter((mark) => badgeAt(mark));
  if (going.length === 0) return;
  const screen = screenSize();
  const nest = state.work.open ? el.work : buttons.send;
  const to = nest.getBoundingClientRect();
  for (const mark of going) {
    const spot = badgeAt(asDrawn(mark, state.front, screen));
    const flying = document.createElement("span");
    flying.className = "flight";
    if (mark.thumb) {
      const picture = document.createElement("img");
      picture.src = mark.thumb;
      picture.alt = "";
      flying.append(picture);
    }
    flying.style.left = `${spot.x * screen.width}px`;
    flying.style.top = `${spot.y * screen.height}px`;
    el.flights.append(flying);
    const across = to.left + to.width / 2 - spot.x * screen.width;
    const down = to.top + to.height / 2 - spot.y * screen.height;
    const run = flying.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${across}px), calc(-50% + ${down}px)) scale(0.25)`,
          opacity: 0,
        },
      ],
      { duration: FLIGHT, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    const drop = () => flying.remove();
    run.finished.then(drop, drop);
  }
}

/**
 * Pick the window up and put it somewhere else.
 *
 * The same shape as the rail's own drag: hold the pointer, follow it, and hold the
 * window inside the room of whichever screen it is being carried over — the desktop
 * spans several, and a window dragged off the edge of one has to stop at the edge of
 * that one rather than at the edge of all of them.
 */
function startWorkDrag(event) {
  // Not the close button, and not a right click on the bar.
  if (event.button !== 0 || event.target.closest(".popup-shut")) return;
  event.preventDefault();
  const box = el.work.getBoundingClientRect();
  const grabX = event.clientX - box.left;
  const grabY = event.clientY - box.top;

  const move = (moved) => {
    const size = el.work.getBoundingClientRect();
    const room = usable(screenAt(state.screens, { x: moved.clientX, y: moved.clientY }));
    state.work.at = {
      x: Math.max(room.left, Math.min(room.right - size.width, moved.clientX - grabX)),
      y: Math.max(room.top, Math.min(room.bottom - size.height, moved.clientY - grabY)),
    };
    placeWork();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    // Where somebody put it is how they set this up, and it is kept with the rest of it.
    remember();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * Where it sits: where it was put, or against the side of the screen the rail is on.
 *
 * The library window is centred because it is opened, used and closed. This one is meant
 * to stay open while somebody works, and a window in the middle of the screen for an
 * hour is a window in the way — so it starts out of the way and then goes wherever it is
 * carried.
 */
function placeWork() {
  const room = usable(screenAt(state.screens, state.work.at || state.at || { x: 0, y: 0 }));
  const box = el.work.getBoundingClientRect();
  // Where it was put, or — the first time — beside the rail that opened it. It used to
  // arrive against the far edge of the screen however far that was from your hand.
  const put =
    state.work.at ||
    besideTheRail(el.wrap.getBoundingClientRect(), box, room, isVertical(state.dock));
  // Held inside the room whatever it was last told, so a window remembered from a
  // desktop with another monitor on it does not open off the side of this one.
  el.work.style.left = `${Math.round(Math.max(room.left, Math.min(room.right - box.width, put.x)))}px`;
  el.work.style.top = `${Math.round(Math.max(room.top, Math.min(room.bottom - box.height, put.y)))}px`;
}
