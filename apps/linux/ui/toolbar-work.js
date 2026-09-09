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

/**
 * Keep the clock in the panel honest while somebody watches it.
 *
 * Every elapsed time is worked out when the row is drawn, and nothing redraws on its
 * own — so an exchange sent a moment ago said "just now" for as long as the panel stayed
 * open, and a run going for ten minutes still claimed to have started a moment ago. The
 * panel is a thing people leave open, which is exactly when a frozen clock is worst.
 *
 * Ticking only while it is open, and only while something might change: once every
 * exchange is old enough to be counted in minutes, a redraw a second is redrawing the
 * same words. Half a minute is finer than the smallest thing `agoSaid` says.
 */
const WORK_TICK = 30 * 1000;
let ticking = null;

function keepTime() {
  const wanted = state.work.open && state.history.length > 0;
  if (wanted === (ticking !== null)) return;
  if (!wanted) {
    clearInterval(ticking);
    ticking = null;
    return;
  }
  ticking = setInterval(() => {
    // Only the panel: a whole render several times a minute to move one word is a cost
    // the rest of the toolbar has no reason to pay.
    if (state.work.open) drawWork();
  }, WORK_TICK);
}

function drawWork() {
  const open = state.work.open;
  el.work.hidden = !open;
  if (!open) {
    keepTime();
    return;
  }

  keepTime();
  const now = Date.now();
  const waiting = needingYou(state.history, state.runs);
  const shown =
    state.work.filter === "needs" ? waiting : state.history;

  el.work.replaceChildren(
    workHead(waiting.length),
    ...(waiting.length && state.work.filter !== "needs" ? [waitingBanner(waiting[0])] : []),
    workLog(shown, now),
    workWrite(),
  );
}

/**
 * The head: what is here, and a way to see only the part that is stuck.
 *
 * The count is the reason to glance at the panel at all, so it is next to the name
 * rather than discovered by scrolling.
 */
function workHead(waiting) {
  const head = document.createElement("div");
  head.className = "work-head";

  const title = document.createElement("div");
  title.className = "work-title";
  const name = document.createElement("span");
  name.className = "work-name";
  name.textContent = "Work";
  const count = document.createElement("span");
  count.className = "work-count";
  count.textContent = workCountSaid(state.history, state.runs);
  title.append(name, count);

  // Two tabs, and only once there is something to filter to. A "Needs you · 0" tab is a
  // control that does nothing, sitting where the eye goes first.
  const tabs = document.createElement("div");
  tabs.className = "work-tabs";
  if (waiting > 0) {
    for (const [id, label] of [
      ["all", "All"],
      ["needs", `Needs you · ${waiting}`],
    ]) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "work-tab";
      tab.dataset.on = String((state.work.filter || "all") === id);
      tab.textContent = label;
      tab.addEventListener("click", () => {
        state.work.filter = id;
        render();
      });
      tabs.append(tab);
    }
  }

  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "popup-shut";
  shut.title = "Close";
  shut.setAttribute("aria-label", "Close the work panel");
  shut.textContent = "×";
  shut.addEventListener("click", closeWork);

  head.append(title, tabs, shut);
  return head;
}

/**
 * One line naming the exchange that has stopped, and a way to reach it.
 *
 * The whole panel can be scrolled past; a question four exchanges down is a question
 * nobody answers. This is the only thing in the panel that jumps somewhere.
 */
function waitingBanner(entry) {
  const bar = document.createElement("div");
  bar.className = "work-banner";
  const said = document.createElement("span");
  said.textContent = `${entry.who} is waiting on an answer`;
  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "work-jump";
  jump.textContent = "Jump";
  jump.addEventListener("click", () => {
    const row = el.work.querySelector(`[data-entry="${entry.at}"]`);
    if (row) row.scrollIntoView({ block: "center", behavior: still() ? "auto" : "smooth" });
  });
  bar.append(said, jump);
  return bar;
}

function workLog(shown, now) {
  const log = document.createElement("div");
  log.className = "work-log scrolls";
  if (shown.length === 0) {
    log.append(state.history.length === 0 ? nothingYet() : saying("Nothing is waiting on you."));
    return log;
  }
  for (const entry of shown) log.append(entryRow(entry, now));
  return log;
}

/**
 * The first thing anyone sees, and it was one grey sentence.
 *
 * Three steps because there are three, and somebody who has just opened this has done
 * none of them. The composer stays below it: the point of the panel is still to send.
 */
function nothingYet() {
  const box = document.createElement("div");
  box.className = "work-empty";
  const title = document.createElement("p");
  title.className = "work-empty-title";
  title.textContent = "Nothing sent yet";
  const said = document.createElement("p");
  said.className = "work-empty-said";
  said.textContent = "Mark something on screen with the toolbar, then say what you want done with it.";
  const steps = document.createElement("ol");
  steps.className = "work-steps";
  for (const step of ["Point at, draw or box a region", "Write the ask below", "Pick who receives it"]) {
    const one = document.createElement("li");
    one.textContent = step;
    steps.append(one);
  }
  box.append(title, said, steps);
  return box;
}

/**
 * One exchange: what went, what came back, and what to do about it.
 *
 * A passage of text on a spine, not a card. Everything visible follows from the state —
 * the pill, the colour of the node, and which actions are worth offering — so there is
 * one place to change what any of them mean.
 */
function entryRow(entry, now) {
  const state_ = stateOf(entry, state.runs);
  const row = document.createElement("div");
  row.className = "work-turn";
  row.dataset.state = state_;
  row.dataset.entry = String(entry.at);

  const node = document.createElement("span");
  node.className = "work-node";

  const meta = document.createElement("div");
  meta.className = "work-meta";
  const face = document.createElement("span");
  face.className = "work-face";
  face.textContent = (entry.who || "?").slice(0, 1).toUpperCase();
  face.style.setProperty("--face", String(handHue(entry.who || "")));
  const who = document.createElement("span");
  who.className = "work-who";
  who.textContent = entry.who;
  const pill = document.createElement("span");
  pill.className = "work-pill";
  pill.textContent = STATES[state_].label;
  const when = document.createElement("span");
  when.className = "work-when";
  when.textContent = briefly(entry.at, now);
  when.title = agoSaid(entry.at, now);
  meta.append(face, who, pill, when);
  row.append(node, meta);

  // What was marked, named rather than pictured. A thumbnail says which screenshot; the
  // word says which tool, and the tool is what somebody remembers about a mark.
  if (entry.marks && entry.marks.length) {
    const marks = document.createElement("div");
    marks.className = "work-marks";
    for (const named of entry.marks) {
      const one = document.createElement("span");
      one.className = "work-mark";
      one.textContent = named;
      marks.append(one);
    }
    row.append(marks);
  }

  // What was asked, folded away. It is context for the reply below it and you wrote it,
  // so it is the one thing here you already know — but it has to stay reachable, because
  // an hour later it is the only way to know what the reply is about.
  row.append(askLine(entry));

  const turns = (entry.answer && entry.answer.turns) || [];
  for (const turn of turns) {
    const line = document.createElement("p");
    line.className = "work-said";
    line.dataset.mine = String(turn.mine === true);
    line.textContent = turn.said;
    row.append(line);
  }
  if (state_ === "blocked") {
    const why = document.createElement("p");
    why.className = "work-said";
    why.textContent = entry.blocked;
    row.append(why);
  }

  const receipt = receiptRow(entry, state_);
  if (receipt) row.append(receipt);

  // One row of buttons, not two. The reply controls and the row's own actions are the
  // same question — what do I do about this — and splitting them put Rewind on a line of
  // its own underneath No/Yes/Reply.
  const acts = actionsFor(entry, state_);
  if (state_ === "asking" && entry.answer) {
    const box = answerBox(entry.answer, acts);
    row.append(box);
  } else {
    row.append(acts);
  }
  return row;
}

/** The ask, one line, opening on a press. */
function askLine(entry) {
  const said = entrySaid(entry);
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "work-ask";
  fold.dataset.open = String(Boolean(entry.showAsk));
  fold.setAttribute("aria-expanded", String(Boolean(entry.showAsk)));
  const mark = document.createElement("span");
  mark.className = "work-ask-mark";
  mark.textContent = "›";
  const words = document.createElement("span");
  words.className = "work-ask-said";
  words.textContent = said;
  fold.append(mark, words);
  fold.addEventListener("click", () => {
    entry.showAsk = !entry.showAsk;
    render();
  });
  return fold;
}

/**
 * What actually happened, in the agent's own terms.
 *
 * The design draws this as `code-bridge · hero.html:38 · +6 −2`, which is the right
 * thing to show and more than colai can currently know: no connector reports the file it
 * touched or how much it changed. So the row says the part that is true — who did it,
 * and through what — and the rest waits for a connector that reports it. A plausible
 * `+6 −2` that nothing measured would be worse than no row at all.
 */
function receiptRow(entry, state_) {
  if (state_ === "working" || state_ === "blocked") return null;
  const through = entry.answer && entry.answer.connector;
  if (!through && state_ !== "done") return null;
  const line = document.createElement("p");
  line.className = "work-receipt";
  const tick = document.createElement("span");
  tick.className = "work-receipt-mark";
  tick.textContent = state_ === "failed" ? "×" : "✓";
  const said = document.createElement("span");
  said.textContent = through ? `${through} · ${entry.who}` : entry.who;
  line.append(tick, said);
  // The design puts `+6 −2` at the end of this row, and only a connector that reports
  // what it wrote can fill it in. Drawn when there is a number and left out when there
  // is not, rather than shown as zeros nothing measured.
  const wrote = entry.answer && entry.answer.wrote;
  if (wrote && (wrote.more || wrote.less)) {
    const count = document.createElement("span");
    count.className = "work-receipt-count";
    const more = document.createElement("span");
    more.className = "work-receipt-more";
    more.textContent = `+${wrote.more || 0}`;
    const less = document.createElement("span");
    less.className = "work-receipt-less";
    less.textContent = `−${wrote.less || 0}`;
    count.append(more, less);
    line.append(count);
  }
  return line;
}

/** What to offer, which is a question about the state and nothing else. */
function actionsFor(entry, state_) {
  const acts = document.createElement("div");
  acts.className = "work-acts";
  const add = (label, lead, why, go) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "work-act";
    button.dataset.lead = String(Boolean(lead));
    button.textContent = label;
    if (why) button.title = why;
    button.addEventListener("click", go);
    acts.append(button);
  };

  if (state_ === "working") {
    add("Stop", false, "Stop this run", () => void stopOne(entry.sessionKey));
  }
  if (state_ === "blocked") {
    add("Discard", false, "Forget this one", () => {
      state.history = state.history.filter((one) => one !== entry);
      render();
    });
  }
  if (state_ === "failed") {
    add("Try again", true, "Send it again, unchanged", () => void resend(entry));
  }
  const may = canGoBack(
    { kind: "session", id: entry.sessionKey, sessionKey: entry.sessionKey },
    state.allowed,
  );
  if (entry.sessionKey) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "work-act";
    back.disabled = !may.can;
    back.textContent = "Rewind";
    back.title = may.why || "Go back to an earlier prompt you sent";
    back.addEventListener("click", () => {
      state.rowMenu = {
        kind: "session",
        id: entry.sessionKey,
        sessionKey: entry.sessionKey,
        name: entry.who,
      };
      void openPoints();
    });
    acts.append(back);
  }
  return acts;
}

/**
 * A reply in words, because most of what an agent says back is not a proposal to accept
 * or refuse. It asks which of two things you meant, or what a value should be — and
 * neither has an answer that fits in two fixed buttons.
 */
function answerBox(answer, acts) {
  const box = document.createElement("div");
  box.className = "work-answer";
  const field = document.createElement("textarea");
  field.className = "popup-note answer-say";
  field.rows = 2;
  field.placeholder = "Answer them…";
  field.value = answer.saying_text || "";
  field.addEventListener("input", () => {
    answer.saying_text = field.value;
    render();
  });
  // The row's own actions, with the quick replies put in front of them.
  const foot = acts;
  const first = [];
  // Still here, because "yes, go on" is the commonest answer in the world — but they
  // fill the box rather than being the only two things sayable.
  for (const [label, words, why] of [
    ["No", "Declined — that is not what I meant.", "Tell them this is not it"],
    ["Yes", "Accepted — go ahead.", "Tell them to go ahead"],
  ]) {
    const quick = document.createElement("button");
    quick.type = "button";
    quick.className = "work-act";
    quick.disabled = Boolean(answer.saying);
    quick.textContent = label;
    quick.title = why;
    quick.addEventListener("click", () => void verdict(answer, words));
    first.push(quick);
  }
  const go = document.createElement("button");
  go.type = "button";
  go.className = "work-act";
  go.dataset.lead = "true";
  go.disabled = Boolean(answer.saying) || !(answer.saying_text || "").trim();
  go.textContent = answer.saying ? "Sending…" : "Reply";
  go.addEventListener("click", () => void verdict(answer, answer.saying_text || ""));
  first.push(go);
  // No, Yes, Reply, then whatever the row already offered — the order somebody reads
  // them in, and built in one go so the loop above cannot reverse it.
  foot.prepend(...first);
  box.append(field, foot);
  return box;
}

/** Stop one run rather than all of them, which is what a row can offer. */
async function stopOne(sessionKey) {
  if (!sessionKey) return;
  const run = state.runs.find((one) => one.sessionKey === sessionKey);
  state.runs = state.runs.filter((one) => one.sessionKey !== sessionKey);
  render();
  try {
    await invoke("colai_stop", { sessionKey });
    // Said, not assumed. A stop that produced no answer looks exactly like a stop that
    // did not happen, and somebody who pressed it needs to know which.
    state.trouble = `Stopped ${run ? run.who : "that run"}.`;
  } catch (error) {
    state.trouble = `Could not stop ${run ? run.who : "that run"} — ${error && error.message ? error.message : String(error)}`;
  }
  render();
}

/**
 * Put a failed ask back in the composer rather than sending it again behind their back.
 *
 * A run that fell over usually fell over for a reason, and re-dispatching the same words
 * without showing them is how somebody watches the same failure twice. The words come
 * back, the cursor is in them, and Send is one press away.
 */
function resend(entry) {
  state.text = entrySaid(entry);
  state.work.filter = "all";
  render();
  const field = el.work.querySelector(".work-write .popup-note");
  if (field) field.focus();
}

/**
 * The composer, at the foot where you type.
 *
 * Below the log rather than above it, so the reply you are answering sits directly over
 * the field. It used to be a staging area at the top with history pushed beneath it,
 * which put the newest thing furthest from the words about it.
 */
function workWrite() {
  // The composer is a card; the setting under it is not part of it. They were one
  // element, so "Show marks on screen" sat inside the box you type a message into,
  // reading as something the message does rather than something the panel does.
  const tail = document.createElement("div");
  tail.className = "work-tail";
  const write = document.createElement("div");
  write.className = "work-write";
  drawComposer(write);

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
  tail.append(write, foot);
  return tail;
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



