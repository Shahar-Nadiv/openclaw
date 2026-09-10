// What comes back, and what it is worth.
//
// The half of this surface that makes it a conversation rather than an outbox. It used
// to arrive as a pin on the region somebody marked and open beside it; now every mark
// is in the Work window and the reply is read there, so what is left here is reading a
// turn out of a message and sending a verdict back.
//
// The pin went with the marks. Once the screen is meant to be quiet, a circle left on it
// is the thing being complained about, not the exception to it.

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
