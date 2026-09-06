// What comes back, landing where it was asked about.
//
// The half of this surface that makes it a conversation rather than an outbox. A reply
// arrives as a pin on the region somebody marked, opens beside it, and can be agreed
// with or refused without going anywhere else — which is the whole reason a mark is
// worth making here rather than in a chat window.

function spokenBy(message) {
  if (!message || message.role !== "assistant") return null;
  const content = message.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const words = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return words || null;
}

/** The overlay's own size, which is what a fraction of it is a fraction of. */
function drawAnswers() {
  // Panels are laid out after everything is mounted, because where one goes depends on
  // how big it turns out to be, and a reply's height is not known until it is in the
  // page. Kept beside their pins rather than inside them: a panel that has been moved
  // to the other side of its pin to fit on the screen is no longer at a fixed offset
  // from it, and nesting it would mean fighting its own parent's position.
  const placing = [];
  el.answers.replaceChildren(
    ...state.answers.flatMap((answer) => {
      const at = document.createElement("div");
      at.className = "answer-at";
      at.style.left = `${answer.at.x * 100}%`;
      at.style.top = `${answer.at.y * 100}%`;

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "answer-dot";
      const latest = lastTurn(answer);
      const asking = Boolean(latest) && asksSomething(latest);
      dot.dataset.waiting = String(!latest);
      dot.dataset.asking = String(asking);
      dot.title = !latest
        ? `Waiting on ${answer.who}`
        : asking
          ? `${answer.who} asked you something`
          : `Reply from ${answer.who}`;
      dot.textContent = !latest ? "…" : asking ? "?" : "";
      dot.addEventListener("click", () => {
        answer.open = !answer.open;
        render();
      });
      at.append(dot);

      if (answer.open && latest) {
        const panel = document.createElement("div");
        panel.className = "answer-said";

        const head = document.createElement("div");
        head.className = "answer-head";
        const who = document.createElement("p");
        who.className = "answer-who";
        who.textContent = answer.who;
        // Closing is not deciding. The answer stays where it is and the pin stays with
        // it, because reading something and having an opinion about it are two moments
        // and this surface should not insist they are one.
        const shut = document.createElement("button");
        shut.type = "button";
        shut.className = "popup-shut";
        shut.title = "Close · the answer stays";
        shut.setAttribute("aria-label", "Close this answer");
        shut.textContent = "\u00d7";
        shut.addEventListener("click", () => {
          answer.open = false;
          render();
        });
        head.append(who, shut);

        const said = document.createElement("div");
        said.className = "answer-text";
        // Every turn, not the first. A run that talks three times is one answer with
        // three turns; keeping only the first threw away the two that usually matter,
        // because an agent says what it is doing before it says what it found.
        for (const turn of answer.turns || []) {
          const line = document.createElement("p");
          line.className = "answer-turn";
          line.dataset.mine = String(turn.mine === true);
          line.textContent = turn.said;
          said.append(line);
        }

        // A reply in words, because most of what an agent says back is not a proposal
        // to accept or refuse. It asks which of two things you meant, or what a value
        // should be, or whether it understood — and none of those have an answer that
        // fits in two fixed buttons.
        const box = document.createElement("textarea");
        box.className = "popup-note answer-say";
        box.rows = 2;
        box.placeholder = asking ? "Answer them…" : "Say something back…";
        box.value = answer.saying_text || "";
        box.addEventListener("input", () => {
          answer.saying_text = box.value;
          const go = panel.querySelector(".popup-go");
          if (go) go.disabled = Boolean(answer.saying) || !box.value.trim();
        });

        const foot = document.createElement("div");
        foot.className = "popup-foot";
        // Still there, because "yes, go on" is the commonest answer in the world — but
        // they fill the box rather than being the only two things sayable.
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

        panel.append(head, said, box, foot);
        // The newest turn is the one being answered, so that is the one to be looking
        // at. Opened at the top, a conversation of four turns shows the first and cuts
        // the question off mid-sentence — which is what it did.
        placing.push([panel, { x: answer.at.x * window.innerWidth, y: answer.at.y * window.innerHeight }, said]);
        return [at, panel];
      }
      return [at];
    }),
  );
  for (const [panel, at, said] of placing) {
    placeAnswer(panel, at);
    if (said) said.scrollTop = said.scrollHeight;
  }
}

/** Put an opened answer where `answerAt` says it goes, and no taller than its screen. */
function placeAnswer(panel, at) {
  panel.style.left = "0px";
  panel.style.top = "0px";
  const room = usable(screenAt(state.screens, at));
  // Never taller than the display it is on. The stylesheet caps it at a share of the
  // window, and this window is every screen at once — stack two monitors and a share
  // of the pair is more than the whole of either. Set before it is measured, because
  // where it goes depends on how tall it ended up.
  panel.style.maxHeight = `min(40vh, ${Math.max(120, room.bottom - room.top - EDGE * 2)}px)`;
  const { left, top } = answerAt(at, panel.getBoundingClientRect(), room);
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/**
 * Say yes or no to an answer, in the conversation it came from.
 *
 * A verdict that went nowhere would be theatre: the point of the answer coming back
 * here is that the agent hears what you make of it, and the place it hears anything is
 * the conversation. So this is a real message, and the agent may well say something
 * back — which is what agreeing or disagreeing with somebody looks like.
 */
/** One turn of what the agent has said, or null while it is still thinking. */
function lastTurn(answer) {
  const turns = answer.turns || [];
  const theirs = turns.filter((turn) => !turn.mine);
  return theirs.length ? theirs[theirs.length - 1].said : null;
}

/**
 * Say something back.
 *
 * The conversation continues rather than ending. It used to close the pin on the way
 * out, which was right when the only two things sayable were "yes" and "no" and wrong
 * the moment somebody could answer a question — an answer usually gets a reply, and a
 * pin that vanished as you sent one would take the reply with it.
 */
async function verdict(answer, said) {
  const words = (said || "").trim();
  if (answer.saying || !words) return;
  answer.saying = true;
  render();
  try {
    await invoke("colai_send", {
      receiver: { kind: "session", id: answer.sessionKey, locator: null },
      message: words,
    });
    answer.saying = false;
    answer.saying_text = "";
    answer.turns = [...(answer.turns || []), { said: words, mine: true }];
    // And it is working again, on this.
    state.runs = [
      ...state.runs.filter((run) => run.sessionKey !== answer.sessionKey),
      { sessionKey: answer.sessionKey, who: answer.who, heard: Date.now() },
    ];
    render();
  } catch (error) {
    answer.saying = false;
    state.trouble = `Could not reply — ${error && error.message ? error.message : String(error)}`;
    render();
  }
}

/** Stop waiting on a conversation, and stop the Gateway talking to nobody. */
async function forgetAnswer(answer) {
  state.answers = state.answers.filter((held) => held !== answer);
  render();
  const still = state.answers.some((held) => held.sessionKey === answer.sessionKey);
  if (!still) await invoke("colai_unwatch", { sessionKey: answer.sessionKey }).catch(() => {});
}
