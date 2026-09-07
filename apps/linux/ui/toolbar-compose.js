// The two surfaces somebody types into: the popup on a mark, and the composer.
//
// The popup opens where they were looking and is about one mark; the composer hangs off
// the rail and is about everything waiting to go. They are the same conversation at two
// sizes, which is why they share a receiver, a mode, and the files coming along — and
// why they live in one file rather than growing two ideas of what a send is.
//
// The agent picker is here too: what it draws is the list those two choose from, and
// the choosing is the point of both of them.

/**
 * The one line of a mark's address that fits beside its thumbnail.
 *
 * The most specific thing known, because that is the thing worth checking: a URL beats
 * a file, a file beats a directory, a directory beats an application name. The whole
 * address goes in the message; this is only enough to see it was picked up right.
 */
function placeSaid(mark) {
  const where = mark.where;
  if (!where || !where.app) return null;
  if (where.url) return where.url;
  const place = placeOf(where);
  if (place.file) return place.file;
  if (place.path) return place.path;
  if (where.cwd) return where.cwd;
  return where.app;
}

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
  what.textContent = labelOf(mark);
  const size = document.createElement("span");
  size.className = "popup-size";
  // What the mark knows, when it knows something exact. A colour you cannot see is a
  // colour you have to send to somebody else to find out.
  const detail = detailOf(mark);
  size.textContent = mark.trouble ? mark.trouble : detail || mark.shot || "taking a picture…";
  if (mark.hex) {
    const swatch = document.createElement("span");
    swatch.className = "popup-swatch";
    swatch.style.background = mark.hex;
    size.prepend(swatch);
  }
  named.append(what, size);
  // Where it was captured, on the mark rather than in a log. This is the half of a mark
  // an agent will act on, and somebody should be able to see it was picked up correctly
  // before they send it — not find out afterwards that the address was wrong.
  const at = placeSaid(mark);
  if (at) {
    const place = document.createElement("span");
    place.className = "popup-size popup-place";
    place.textContent = at;
    place.title = at;
    named.append(place);
  }
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

  if (mark.tool === "design") {
    // Which of the four this is. Chips rather than a menu: they are four ways of
    // reading the same picture, and seeing them side by side is what tells somebody
    // that "redline" and "tokens" are different questions.
    const kinds = document.createElement("div");
    kinds.className = "mode-row design-row";
    for (const [id, kind] of Object.entries(DESIGNS)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", String((mark.design || DESIGN_FIRST) === id));
      chip.textContent = kind.chip || kind.label;
      chip.addEventListener("click", () => {
        mark.design = id;
        // The home moves with the kind, unless somebody has typed over it. A redline
        // left pointing at the path a wireframe suggested is the sort of wrong that
        // only shows up in a pull request.
        if (!mark.destTyped) mark.dest = kind.home || "";
        render();
      });
      kinds.append(chip);
    }
    rows.push(kinds);

    const kind = kindOf(mark);
    const where = document.createElement("input");
    where.className = "popup-note popup-dest";
    where.type = "text";
    where.value = mark.dest || "";
    // A component has no home to suggest, because only the repository knows where its
    // own components go. Empty is the honest answer, and the placeholder says so
    // rather than leaving a blank box that looks unfinished.
    where.placeholder = kind.home || "wherever this project keeps them";
    where.setAttribute("aria-label", `Where the ${kind.label.toLowerCase()} goes`);
    where.addEventListener("input", () => {
      mark.dest = where.value;
      mark.destTyped = true;
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
/**
 * The files and folders coming along, and the two ways to add one.
 *
 * Under the note rather than above it, because what somebody types is the point and a
 * list of attachments that pushes it off the menu is a file manager with a text box in
 * it. Each one says whether it is travelling or only being named — the difference is
 * the difference between an agent that can see the thing and one that has to go and
 * open it, and finding that out after sending is finding it out too late.
 */
function fileRows() {
  const rows = [];
  for (const file of carrying(state.files)) {
    const row = document.createElement("div");
    row.className = "row file-row";
    row.dataset.carried = String(file.carried);
    const said = document.createElement("span");
    said.className = "agent-name";
    said.textContent = file.name;
    said.title = file.path;
    // One label, not two. A size on the left and "named · 41 MB" on the right is the
    // same fact twice, and the half worth reading first is what is going to happen to
    // it — so the fate leads and the reason follows it.
    const how = document.createElement("span");
    how.className = "row-key";
    how.textContent = file.carried
      ? `attached · ${sizeOf(file.bytes)}`
      : file.why === "no room left"
        ? `named · no room left, ${sizeOf(file.bytes)}`
        : `named · ${file.why}`;
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "file-drop";
    drop.title = `Leave ${file.name} out`;
    drop.setAttribute("aria-label", `Leave ${file.name} out`);
    drop.textContent = "✕";
    drop.addEventListener("click", () => {
      state.files = state.files.filter((had) => had.path !== file.path);
      render();
    });
    row.append(said, how, drop);
    rows.push(row);
  }

  const add = document.createElement("div");
  add.className = "mode-row file-add";
  for (const [label, folders] of [
    ["Add files", false],
    ["Add a folder", true],
  ]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = label;
    chip.addEventListener("click", () => void pickFiles(folders));
    add.append(chip);
  }
  const hint = document.createElement("span");
  hint.className = "file-hint";
  hint.textContent = "or drop them here";
  add.append(hint);
  rows.push(add);
  return rows;
}

/** Ask the desktop for files, and keep whatever comes back that is not already here. */
async function pickFiles(folders) {
  try {
    bringFiles(await invoke("colai_pick_files", { folders }));
  } catch (error) {
    state.trouble = `Could not open the file chooser — ${error && error.message ? error.message : String(error)}`;
    render();
  }
}

/**
 * Take paths into the send, without taking any of them twice.
 *
 * By path, because the same file dropped twice is the same file, and a list that shows
 * it twice would also encode it twice into the message.
 */
function bringFiles(brought) {
  if (!brought || !brought.length) return;
  const had = new Set(state.files.map((file) => file.path));
  state.files = [...state.files, ...brought.filter((file) => !had.has(file.path))];
  // Opened, because a file dropped onto a closed toolbar has nowhere visible to land,
  // and something that vanishes on arrival reads as a drop that failed.
  state.open = "send";
  render();
}

/**
 * What else can be done to one conversation.
 *
 * One item today and built for more, which is why it is a menu rather than a button. It
 * says why something is not available rather than hiding it: a row that quietly offers
 * less than its neighbour is a row somebody assumes is broken.
 */
function drawRowMenu() {
  const about = state.rowMenu;
  const rows = [];
  const title = document.createElement("p");
  title.className = "agents-title";
  title.textContent = (about && about.name) || "This conversation";
  rows.push(title);

  const may = canGoBack(about, state.allowed);
  for (const [id, how] of Object.entries(GOING_BACK)) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "row row-stacked";
    item.disabled = !may.can;
    const name = document.createElement("span");
    name.textContent = how.label;
    const says = document.createElement("span");
    says.className = "row-under";
    says.textContent = how.says;
    item.append(name, says);
    item.addEventListener("click", () => void openPoints(id));
    rows.push(item);
  }
  if (!may.can) {
    const why = document.createElement("p");
    why.className = "cron-bare";
    why.textContent = may.why;
    rows.push(why);
  }
  el.flyRow.replaceChildren(...rows);
}

/**
 * Ask the conversation where it could go back to.
 *
 * Asked when somebody opens the list rather than kept warm: a transcript grows with
 * every message, and a list fetched earlier is a list that is quietly out of date about
 * the thing somebody is about to act on.
 */
async function openPoints(how) {
  const about = state.rowMenu;
  if (!about || !about.sessionKey) return;
  state.points = { how, loading: true, list: [], trouble: null };
  flyout("points");
  try {
    state.points.list = await invoke("colai_points", { sessionKey: about.sessionKey });
  } catch (error) {
    state.points.trouble = error && error.message ? error.message : String(error);
  }
  state.points.loading = false;
  render();
}

/**
 * Where this conversation could be taken back to.
 *
 * Each row is one of somebody's own messages. The note under them is the important
 * sentence on this surface and it is stated once, plainly, before anything is chosen:
 * the conversation goes back, the files do not.
 */
function drawPoints() {
  const found = state.points;
  const how = GOING_BACK[(found && found.how) || "rewind"];
  const rows = [];
  const title = document.createElement("p");
  title.className = "agents-title";
  title.textContent = how.label;
  rows.push(title);

  const bare = document.createElement("p");
  bare.className = "cron-bare";
  bare.textContent = how.fork
    ? "Starts a new conversation from that point. This one is left as it is, and so are your files."
    : "Takes this conversation back to that point. Your files are not touched — only the conversation.";
  rows.push(bare);

  if (found && found.loading) {
    rows.push(saying("Looking…"));
  } else if (found && found.trouble) {
    rows.push(saying(`Could not read it — ${found.trouble}`));
  } else if (!found || found.list.length === 0) {
    // Honest about the useless answer. The transcript may be empty, or it may be a shape
    // this build cannot find message ids in; either way there is nowhere to go, and
    // saying so beats an empty list somebody stares at.
    rows.push(saying("Nothing here to go back to."));
  } else {
    const now = Date.now();
    for (const point of [...found.list].reverse()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "row";
      const { words, when } = pointSaid(point, now);
      const said = document.createElement("span");
      said.className = "agent-name";
      said.textContent = words;
      item.append(said);
      if (when) {
        const ago = document.createElement("span");
        ago.className = "row-key";
        ago.textContent = when;
        item.append(ago);
      }
      item.title = point.said || "";
      item.addEventListener("click", () => void goBack(point));
      rows.push(item);
    }
  }
  el.flyPoints.replaceChildren(...rows);
}

/** One line of prose in a menu that has nothing else to show. */
function saying(words) {
  const line = document.createElement("p");
  line.className = "agent-empty";
  line.textContent = words;
  return line;
}

/**
 * Do it, and say what was done.
 *
 * The first thing on this surface that discards work, so the receipt is not optional —
 * and what came back in the composer is the point of the whole exercise: your words
 * return so you can say them differently.
 */
async function goBack(point) {
  const about = state.rowMenu;
  const how = GOING_BACK[(state.points && state.points.how) || "rewind"];
  if (!about || !about.sessionKey || state.sending) return;
  state.sending = true;
  render();
  try {
    const back = await invoke("colai_rewind", {
      sessionKey: about.sessionKey,
      entryId: point.id,
      fork: how.fork,
    });
    state.open = null;
    state.points = null;
    if (back && back.editorText) state.text = back.editorText;
    state.trouble = how.fork
      ? `Started a new conversation from “${(point.said || "that point").slice(0, 40)}”.`
      : `${about.name} is back at “${(point.said || "that point").slice(0, 40)}”. The files are as they were.`;
    void loadWho();
  } catch (error) {
    state.trouble = `Could not go back — ${error && error.message ? error.message : String(error)}`;
  } finally {
    state.sending = false;
    render();
  }
}

/**
 * The automation panel: the same request, on a schedule.
 *
 * Built out of the pieces the composer already uses — chips for a choice between a few,
 * the note field's own input for anything typed — so it reads as another face of the
 * send key rather than a settings page that wandered onto the desktop.
 *
 * What is not here is the point. OpenClaw's own form folds triggers, wake mode,
 * timeouts, delivery routes and tool allowances behind "Advanced"; on an overlay they
 * are not folded, they are absent. Somebody who needs them is somebody who should be
 * sitting in the Control UI.
 */
function drawAutomation() {
  const rows = [];
  const cron = state.cron;

  const title = document.createElement("p");
  title.className = "agents-title";
  title.textContent = "Create an automation";
  rows.push(title);

  const name = document.createElement("input");
  name.className = "popup-note";
  name.type = "text";
  name.value = cron.name;
  name.placeholder = nameFor(state.marks, state.text, state.surface);
  name.setAttribute("aria-label", "What this automation is called");
  name.addEventListener("input", () => {
    cron.name = name.value;
  });
  rows.push(name);

  rows.push(
    chips("How often", REPEATS, cron.repeat, (id) => {
      cron.repeat = id;
      render();
    }),
  );

  if (cron.repeat === "every") {
    const line = document.createElement("div");
    line.className = "cron-line";
    const amount = document.createElement("input");
    amount.className = "popup-note cron-amount";
    amount.type = "number";
    amount.min = "1";
    amount.value = cron.amount;
    amount.setAttribute("aria-label", "How many");
    amount.addEventListener("input", () => {
      cron.amount = amount.value;
      drawSchedule();
    });
    line.append(amount);
    line.append(chips(null, UNITS, cron.unit, (id) => {
      cron.unit = id;
      render();
    }));
    rows.push(line);
  } else if (cron.repeat === "at") {
    rows.push(
      field("datetime-local", cron.at, "When it runs", (value) => {
        cron.at = value;
      }),
    );
  } else {
    rows.push(
      field("text", cron.expr, "Cron expression", (value) => {
        cron.expr = value;
      }, "0 9 * * *"),
    );
    rows.push(
      field("text", cron.tz, "Timezone", (value) => {
        cron.tz = value;
      }, "Leave blank for this machine's"),
    );
  }

  // Said back before it is agreed to. "Every 30" is a setting; "Runs every 30 minutes"
  // is a promise, and the difference is whether anybody notices they typed 30 into the
  // days field.
  const summary = document.createElement("p");
  summary.className = "cron-summary";
  summary.id = "cron-summary";
  rows.push(summary);

  rows.push(
    chips("Runs in", { isolated: { label: "Its own session" }, main: { label: "Main session" } },
      cron.where, (id) => {
        cron.where = id;
        render();
      }),
  );

  // The one thing this cannot do, said where it matters rather than discovered later.
  const bare = document.createElement("p");
  bare.className = "cron-bare";
  bare.textContent = "Carries your words, not the pictures — a scheduled run goes and looks for itself.";
  rows.push(bare);

  const foot = document.createElement("div");
  foot.className = "popup-foot";
  const to = document.createElement("button");
  to.type = "button";
  to.className = "popup-to";
  to.textContent = state.receiving.name || "Choose who receives";
  to.title = "Change who this runs as";
  to.addEventListener("click", () => flyout("agents"));
  const make = document.createElement("button");
  make.type = "button";
  make.className = "popup-do popup-go";
  make.disabled = state.sending || scheduleOf(cron) === null;
  make.textContent = state.sending ? "Creating…" : "Create";
  make.addEventListener("click", () => void createAutomation());
  foot.append(to, make);
  rows.push(foot);

  el.flyAutomate.replaceChildren(...rows);
  drawSchedule();
}

/** The sentence under the schedule, redrawn on its own so typing does not rebuild the panel. */
function drawSchedule() {
  const summary = document.getElementById("cron-summary");
  if (!summary) return;
  const says = scheduleSays(state.cron);
  summary.textContent = says || "Not a schedule yet.";
  summary.dataset.ready = String(says !== null);
  const make = el.flyAutomate.querySelector(".popup-go");
  if (make) make.disabled = state.sending || says === null;
}

/** A row of chips over a table of choices, the way the modes are drawn. */
function chips(label, table, chosen, pick) {
  const row = document.createElement("div");
  row.className = "mode-row";
  if (label) {
    const said = document.createElement("span");
    said.className = "chip-label";
    said.textContent = label;
    row.append(said);
  }
  for (const [id, entry] of Object.entries(table)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", String(chosen === id));
    chip.textContent = entry.label;
    chip.addEventListener("click", () => pick(id));
    row.append(chip);
  }
  return row;
}

/** One typed field, in the note's own clothes. */
function field(type, value, label, onInput, placeholder) {
  const input = document.createElement("input");
  input.className = "popup-note";
  input.type = type;
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => {
    onInput(input.value);
    drawSchedule();
  });
  return input;
}

/**
 * Make the job.
 *
 * The marks stay. An automation is not a send — nothing has gone anywhere yet — and
 * clearing the tray because somebody scheduled something would lose the work they were
 * still holding.
 */
async function createAutomation() {
  const schedule = scheduleOf(state.cron);
  if (!schedule || state.sending) return;
  const who = receiverNow();
  if (!who) {
    state.trouble = "Nobody is receiving. Choose an agent or a conversation first.";
    render();
    return;
  }
  state.sending = true;
  render();
  try {
    const made = await invoke("colai_automate", {
      receiver: who,
      asked: {
        name: state.cron.name.trim() || nameFor(state.marks, state.text, state.surface),
        schedule,
        sessionTarget: state.cron.where,
        // Immediately when its time comes, rather than at the next heartbeat. The
        // Control UI keeps this choice under Advanced and defaults it the same way.
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: automationFor(state.marks, state.mode, state.text, state.surface),
        },
      },
    });
    if (who.kind === "thread") state.adopted = [...state.adopted, who.id];
    state.open = null;
    state.trouble = `Automation created${made && made.name ? ` — ${made.name}` : ""}.`;
  } catch (error) {
    state.trouble = `Could not create that — ${error && error.message ? error.message : String(error)}`;
  } finally {
    state.sending = false;
    render();
  }
}

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
    const row = document.createElement("div");
    row.className = "row mark-row";

    // The tick, the picture and the name toggle together, because they are all the same
    // question — is this one going? The note beside them is not, which is why it sits
    // outside the label rather than inside it: a click meant for the words somebody is
    // about to change must not untick the mark they are changing them on.
    const pick = document.createElement("label");
    pick.className = "mark-pick";
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
    // Numbered the way the glass numbers it and the way the message will, so all three
    // agree about which one is being talked about.
    const number = document.createElement("span");
    number.className = "mark-number";
    const called = numberOf(state.marks, mark);
    number.textContent = called === null ? "" : String(called);
    const said = document.createElement("span");
    said.className = "agent-name";
    // Named the way the message will name it, so what somebody ticks in the tray and
    // what the agent reads are the same word.
    said.textContent = labelOf(mark);
    said.title = said.textContent;
    pick.append(tick, shot, number, said);

    // Its note, here as well as in the popup. Marks travel in groups now, and the popup
    // reaches whichever one is newest — going back to change what you wrote on the first
    // of four meant discarding three and starting again.
    const note = document.createElement("input");
    note.type = "text";
    note.className = "mark-note";
    note.value = mark.note || "";
    note.placeholder = "What about it?";
    note.setAttribute("aria-label", `What about ${said.textContent}`);
    note.addEventListener("input", () => {
      mark.note = note.value;
    });

    row.append(pick, note);
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

  rows.push(...fileRows());

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
  // What the toolbar can see, offered rather than done.
  //
  // Choosing one of these is not like choosing an agent: sending to a conversation
  // held in another agent adopts it, which hands it to the Gateway and can fail
  // outright if something is already running it. That is a decision, and a decision
  // taken on somebody's behalf because a window happened to be in front is the toolbar
  // arranging a handover nobody asked for. So it says what it sees and waits.
  if (state.inFront && state.inFront.threads.length && !state.picked) {
    const suggested = state.inFront.threads[0];
    const offer = document.createElement("button");
    offer.type = "button";
    offer.className = "row suggest-row";
    const face = document.createElement("span");
    face.className = "agent-avatar-dot";
    face.textContent = suggested.title.slice(0, 1).toUpperCase();
    const said = document.createElement("span");
    said.className = "agent-name";
    said.textContent = suggested.title;
    const why = document.createElement("span");
    why.className = "row-key";
    why.textContent = `${state.inFront.label} is in front`;
    offer.append(face, said, why);
    offer.addEventListener("click", () =>
      receive("thread", suggested.id, suggested.title, null, suggested.locator),
    );
    rows.push(offer);
  }

  // When the thing in front has a project, offer a conversation that starts there
  // rather than one that has to be told where "there" is.
  if (state.inFront && state.inFront.path) {
    const fresh = document.createElement("button");
    fresh.type = "button";
    fresh.className = "popup-do";
    fresh.textContent = "New here";
    fresh.title = `Start a new conversation in ${state.inFront.path}`;
    fresh.disabled = state.sending;
    fresh.addEventListener("click", () => void startHere());
    foot.append(fresh);
  }

  // The other thing that can be done with what is in the tray. A row rather than a
  // fourth button in the foot, and visible rather than a right click somebody has to
  // be told about — the send key opens this panel, so this panel is where scheduling
  // has to be findable from.
  const later = document.createElement("button");
  later.type = "button";
  later.className = "row row-quiet";
  later.textContent = "Run this on a schedule…";
  later.addEventListener("click", () => {
    state.cron = { ...AUTOMATION_FIRST };
    flyout("automate");
  });
  rows.push(later);

  const go = document.createElement("button");
  go.type = "button";
  go.className = "popup-do popup-go";
  const going = chosenMarks();
  go.disabled =
    state.sending || (going.length === 0 && state.files.length === 0 && !state.text.trim());
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
          about: {
            kind: "session",
            id: session.key,
            name: session.title,
            sessionKey: session.key,
          },
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
    about: {
      kind: "thread",
      id: thread.id,
      name: thread.title,
      // A thread has no session until it has been sent to; the toolbar knows which of
      // them it adopted, and that is the only kind that can be gone back through.
      sessionKey: state.adoptedKeys ? state.adoptedKeys[thread.id] : undefined,
    },
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

function whoRow({ face, name, note, busy, receiving, onPick, about }) {
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
  if (!about) return row;

  // What else can be done to this conversation. The dots and the right click open the
  // same menu, deliberately: right click is the shortcut somebody who knows reaches for,
  // and the dots are how anybody else finds out there is anything there at all. A menu
  // with only the shortcut has already cost this project two "where is it?" questions.
  const line = document.createElement("div");
  line.className = "row-line";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "row-more";
  more.textContent = "\u22ef";
  more.title = `More for ${name}`;
  more.setAttribute("aria-label", `More for ${name}`);
  const open = (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.rowMenu = about;
    state.points = null;
    flyout("row");
  };
  more.addEventListener("click", open);
  row.addEventListener("contextmenu", open);
  more.addEventListener("contextmenu", open);
  line.append(row, more);
  return line;
}
