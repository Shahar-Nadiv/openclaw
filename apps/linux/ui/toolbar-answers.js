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
      dot.dataset.waiting = String(!answer.said);
      dot.title = answer.said ? `Reply from ${answer.who}` : `Waiting on ${answer.who}`;
      dot.textContent = answer.said ? "" : "…";
      dot.addEventListener("click", () => {
        answer.open = !answer.open;
        render();
      });
      at.append(dot);

      if (answer.open && answer.said) {
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

        const said = document.createElement("p");
        said.className = "answer-text";
        said.textContent = answer.said;

        const foot = document.createElement("div");
        foot.className = "popup-foot";
        const no = document.createElement("button");
        no.type = "button";
        no.className = "popup-do";
        no.disabled = Boolean(answer.saying);
        no.textContent = "Decline";
        no.title = "Tell them this is not it";
        no.addEventListener("click", () => void verdict(answer, "Declined — that is not what I meant."));
        const yes = document.createElement("button");
        yes.type = "button";
        yes.className = "popup-do popup-go";
        yes.disabled = Boolean(answer.saying);
        yes.textContent = answer.saying ? "Sending…" : "Accept";
        yes.title = "Tell them to go ahead";
        yes.addEventListener("click", () => void verdict(answer, "Accepted — go ahead."));
        foot.append(no, yes);

        panel.append(head, said, foot);
        placing.push([panel, { x: answer.at.x * window.innerWidth, y: answer.at.y * window.innerHeight }]);
        return [at, panel];
      }
      return [at];
    }),
  );
  for (const [panel, at] of placing) placeAnswer(panel, at);
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
async function verdict(answer, said) {
  if (answer.saying) return;
  answer.saying = true;
  render();
  try {
    await invoke("colai_send", {
      receiver: { kind: "session", id: answer.sessionKey, locator: null },
      message: said,
      markIds: [],
    });
    answer.saying = false;
    await forgetAnswer(answer);
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
