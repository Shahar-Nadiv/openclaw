// Handing what was marked to whoever is receiving it.
//
// What happens after somebody has decided. The surfaces they decided on are next door in
// toolbar-compose.js; this is the part that resolves a receiver, says what an agent
// reads, sends it, and leaves the screen ready for the answer to come back to.
//
// One send, several doors into it. A mark can go from its own popup, from the composer
// with several others, or on its own because a watched region moved while nobody was
// looking — and the last of those must leave a half-written note and a chosen tool
// exactly as it found them, which is the only thing that makes those three different.

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
      // Which of them would rather be one picture than several. Decided here rather than
      // in the capture, because it is the same decision the message states — and the two
      // must agree or the message names files that were never sent.
      sheets: going.filter(sheeted).map((mark) => mark.id),
      accent: accentNow(),
      // Only the ones that travel. What is named rather than carried is already in the
      // message as a path, and sending it twice would mean encoding a gigabyte to say
      // something the sentence above it already said.
      files: alone
        ? []
        : carrying(state.files)
            .filter((file) => file.carried)
            .map((file) => file.path),
    });
    if (who.kind === "thread") {
      state.adopted = [...state.adopted, who.id];
      // Adopting a thread is what gives it a Gateway session, and a session is the only
      // thing that can be taken back to an earlier point. Remembered here because this
      // is the moment it becomes true.
      state.adoptedKeys = { ...state.adoptedKeys, [who.id]: sent.sessionKey };
    }
    // Something is now working. Kept from here rather than waiting for the first frame
    // back: an agent that thinks for a minute before saying anything is working the
    // whole time, and a rail that only lights up once it starts talking is a rail that
    // was dark for the part somebody was wondering about.
    state.runs = [
      ...state.runs.filter((run) => run.sessionKey !== sent.sessionKey),
      { sessionKey: sent.sessionKey, who: state.receiving.name || who.id, heard: Date.now() },
    ];
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
        turns: [],
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
