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
  head.className = "library-head";
  const title = document.createElement("p");
  title.className = "agents-title";
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
  if (entry.shots.length) {
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
  row.append(said);

  const answer = entry.answer;
  const latest = answer && lastTurn(answer);
  if (latest) {
    const came = document.createElement("p");
    came.className = "work-back";
    came.textContent = latest;
    row.append(came);
  } else if (answer) {
    // The same thing the pin says, in words rather than in a crab: this one is still out.
    const still = document.createElement("p");
    still.className = "work-waiting-on";
    still.textContent = `Waiting on ${entry.who}`;
    row.append(still);
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
 * Against the side of the screen the rail is on, not the middle of it.
 *
 * The library window is centred because it is opened, used and closed. This one is meant
 * to stay open while somebody works, and a window that sits in the middle of the screen
 * for an hour is a window in the way.
 */
function placeWork() {
  const room = usable(screenAt(state.screens, state.at || { x: 0, y: 0 }));
  const box = el.work.getBoundingClientRect();
  el.work.style.left = `${Math.round(room.right - box.width - EDGE)}px`;
  el.work.style.top = `${Math.round(room.top + Math.max(0, room.bottom - room.top - box.height) / 2)}px`;
}
