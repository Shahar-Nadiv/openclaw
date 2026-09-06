// Deciding what to do with something you marked, and who gets it.
//
// The popup that opens on a finished mark, the tray of everything kept, the composer
// that sends a batch, and the menu of who could receive it. Apart from the page because
// it answers a different question: the rail is about pointing at things, and all of
// this is about what happens next.
//
// A classic script like the rest of the toolbar, sharing one global scope with it. It
// reads `el` and `state` from toolbar.js, which is loaded first.

/* ── what to do with what was marked ─────────────────────────────────────── */

/**
 * Put a mark back, exactly as undo would.
 *
 * There are three ways out of the popup — the cross, Escape, and a click anywhere off
 * it — and all of them mean the same thing, because somebody who wants out of a dialog
 * should not have to work out which exit destroys their work. None of them do: the mark
 * goes onto the redo trail, so a dismissal that was not meant is one keystroke from
 * being taken back.
 */
function cancelMark(id) {
  const at = state.marks.findIndex((mark) => mark.id === id);
  if (at >= 0) state.undone.push(state.marks.splice(at, 1)[0]);
  state.popup = null;
  if (state.comparing === id) state.comparing = null;
  render();
}

/**
 * The middle of everything being sent, in fractions of the overlay.
 *
 * One answer for a batch, placed over the things it was asked about. Sending three
 * marks and getting three identical pins would be three copies of one reply pretending
 * to be three answers.
 */
function middleOf(marks) {
  const spots = marks.flatMap((mark) =>
    mark.region
      ? [
          { x: mark.region.box.x + mark.region.box.w / 2, y: mark.region.box.y + mark.region.box.h / 2 },
        ]
      : mark.points,
  );
  if (spots.length === 0) return { x: 0.5, y: 0.5 };
  return {
    x: spots.reduce((sum, spot) => sum + spot.x, 0) / spots.length,
    y: spots.reduce((sum, spot) => sum + spot.y, 0) / spots.length,
  };
}

/**
 * Open a new conversation where the work is, seeded with what was marked.
 *
 * The first thing a fresh session sees is the reason it exists, rather than an empty
 * prompt somebody then has to explain themselves into.
 */
async function startHere() {
  const project = state.inFront;
  const example = project && project.threads[0];
  if (!project || !project.path || !example) return;
  const going = chosenMarks();
  state.sending = true;
  render();
  try {
    await invoke("colai_start_here", {
      asked: {
        catalogId: example.locator.catalogId,
        hostId: example.locator.hostId,
        agentId: example.locator.agentId || "main",
        cwd: project.path,
        initialMessage: summaryFor(going, state.mode, state.text, state.surface, state.files),
      },
    });
    // The marks stay. A new conversation has been opened with them, and until it is
    // listed among the receivers there is nothing here to send them to twice.
    state.open = null;
    state.trouble = `Opened a new conversation in ${project.label}.`;
  } catch (error) {
    state.trouble = `Could not start there — ${error && error.message ? error.message : String(error)}`;
  } finally {
    state.sending = false;
    render();
  }
}

/** The marks that go in the next send, in the order they were made. */
function chosenMarks() {
  return state.marks.filter((mark) => mark.chosen);
}

/** Who is receiving, as the shell needs them named. */
function receiverNow() {
  const who = state.receiving;
  if (!who.id) return null;
  return { kind: who.kind, id: who.id, locator: who.locator || null };
}

/** Whether sending to this receiver would hand a conversation over without asking. */
function needsAgreeing() {
  return state.receiving.kind === "thread" && !state.adopted.includes(state.receiving.id);
}

/**
 * Send what was marked.
 *
 * The message is composed here rather than in the shell, because what an agent reads is
 * a decision about the marks somebody made and belongs beside them. The shell resolves
 * the receiver, attaches the pictures and reports what happened.
 */
/**
 * Send marks to whoever is receiving.
 *
 * `alone` is for a send nobody asked for at that moment — a watch firing while somebody
 * is in another window. It carries the mark and nothing else, and leaves the composer
 * exactly as it was found: clearing a half-written note and putting somebody's tool
 * away because a build finished is the toolbar taking their turn.
 */
async function sendMarks(ids, alone) {
  if (state.sending) {
    // A send nobody pressed a button for cannot just evaporate because one was already
    // in the air. The pair is in the tray with both its pictures; this says so, and it
    // can go by hand.
    if (alone) {
      state.trouble = "A watched region changed while another send was going out. It is waiting in the tray.";
      render();
    }
    return;
  }
  const who = receiverNow();
  if (!who) {
    state.trouble = "Nobody is receiving. Choose an agent or a conversation first.";
    render();
    return;
  }
  const going = state.marks.filter((mark) => ids.includes(mark.id));
  // The gate, at the moment it means something. Reading is universal and changing a
  // surface is not, so a tool that writes is refused unless a connector owns what it
  // was pointed at — refused here, before anything is dispatched, so there is no path
  // where a write is attempted and then apologised for. Nothing writes yet; this is
  // what will stop the first one that does.
  const refused = going.map((mark) => gateFor(mark.tool, state.surface)).find((said) => said.blocked);
  if (refused) {
    state.trouble = refused.says;
    render();
    return;
  }
  state.sending = true;
  render();
  try {
    const sent = await invoke("colai_send", {
      receiver: who,
      message: summaryFor(
        going,
        state.mode,
        alone ? "" : state.text,
        state.surface,
        alone ? [] : state.files,
      ),
      markIds: ids,
      // Only the ones that travel. What is named rather than carried is already in the
      // message as a path, and sending it twice would mean encoding a gigabyte to say
      // something the sentence above it already said.
      files: alone
        ? []
        : carrying(state.files)
            .filter((file) => file.carried)
            .map((file) => file.path),
    });
    if (who.kind === "thread") state.adopted = [...state.adopted, who.id];
    // What went is gone; what was left unticked is still there, which is the whole
    // point of being able to untick it.
    state.marks = state.marks.filter((mark) => !ids.includes(mark.id));
    if (!alone) {
      state.files = [];
      state.text = "";
      state.popup = null;
      state.open = null;
    }
    // And put the tool away. A marking tool holds a sheet of glass over the whole desk
    // that swallows every click on it, which is what marking needs and is the opposite
    // of what somebody needs the moment they have finished. Sending is the end of the
    // gesture: what was marked has gone, and leaving the desktop deaf until they
    // thought to press Escape is not something anybody asked for.
    //
    // Not when nobody asked, though: a watch that fires while somebody is drawing a
    // box would take the tool out of their hand mid-drag.
    if (!alone) state.tool = "pointer";
    // Where to put the answer when it comes. The marks are about to be cleared, so the
    // place they were asking about has to be kept now or the reply has nowhere to land
    // — which was the whole trouble with this surface: you sent, and nothing ever came
    // back to the screen you were looking at.
    // Only when the answer can actually come back. A pin waiting on a reply that will
    // never arrive here looks exactly like an agent still thinking, which is the one
    // thing it must not look like.
    if (sent.watching) {
      state.answers.push({
        sessionKey: sent.sessionKey,
        at: middleOf(going),
        who: state.receiving.name || who.id,
        said: null,
        open: false,
      });
    }
    state.trouble = sent.watching
      ? null
      : `Sent, but the reply will only be in ${state.receiving.name || who.id} — colai could not listen for it here.`;
  } catch (error) {
    state.trouble = `Could not send — ${error && error.message ? error.message : String(error)}`;
  } finally {
    state.sending = false;
    render();
  }
}

/** The popup that opens on a finished mark. */
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
  what.textContent = TOOLS[mark.tool] ? TOOLS[mark.tool].label : mark.tool;
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

  if (mark.tool === "wireframe") {
    const where = document.createElement("input");
    where.className = "popup-note popup-dest";
    where.type = "text";
    where.value = mark.dest || WIREFRAME_HOME;
    where.setAttribute("aria-label", "Where the wireframe document goes");
    where.addEventListener("input", () => {
      mark.dest = where.value;
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
  // A watch is not sent now — that is the whole point of it. The note above travels
  // with the pair when it fires, so this is where somebody says what they are waiting
  // for and then agrees to be told about it.
  if (mark.tool === "watch") {
    now.textContent = "Watch this";
    now.title = `Tell ${state.receiving.name || "whoever receives"} when this changes`;
    now.addEventListener("click", () => void startWatching(mark));
  } else {
    now.textContent = state.sending ? "Sending…" : needsAgreeing() ? "Send and adopt" : "Send now";
    now.addEventListener("click", () => void sendMarks([mark.id]));
  }
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
    const row = document.createElement("label");
    row.className = "row mark-row";
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
    const said = document.createElement("span");
    said.className = "agent-name";
    const tool = TOOLS[mark.tool] ? TOOLS[mark.tool].label : mark.tool;
    said.textContent = mark.note ? `${tool} — ${mark.note}` : tool;
    said.title = said.textContent;
    row.append(tick, shot, said);
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

function whoRow({ face, name, note, busy, receiving, onPick }) {
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
  return row;
}
