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
  render();
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
async function sendMarks(ids) {
  if (state.sending) return;
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
      message: summaryFor(going, state.mode, state.text, state.surface),
      markIds: ids,
    });
    if (who.kind === "thread") state.adopted = [...state.adopted, who.id];
    // What went is gone; what was left unticked is still there, which is the whole
    // point of being able to untick it.
    state.marks = state.marks.filter((mark) => !ids.includes(mark.id));
    state.text = "";
    state.popup = null;
    state.open = null;
    // Nothing is said about it. What was sent leaves the tray and the count on the rail
    // drops, which is the outcome — a line announcing what just visibly happened is the
    // sort of thing somebody reads once and then reads past forever.
    state.trouble = null;
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
  const go = document.createElement("button");
  go.type = "button";
  go.className = "popup-do popup-go";
  const going = chosenMarks();
  go.disabled = state.sending || (going.length === 0 && !state.text.trim());
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
