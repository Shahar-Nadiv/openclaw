// Choosing a component, or a design system, out of somebody's catalogue.
//
// A window rather than a flyout, and the only one in this toolbar. Every other menu here
// is a list of words, where the thing being chosen *is* its name — a pen, a length, a
// conversation. A component is not: nobody recognises "Aurora card" from the words, they
// recognise it from the picture. So this needs room for pictures, and room is what makes
// it a window.
//
// Nothing here holds an account. The search runs through the agent's own catalogue tool,
// which means whatever somebody connected in OpenClaw is what they see, and colai stores
// none of it. When nothing is connected the window says so and says what to do about it,
// which is the whole reason it opens rather than the chip greying out: a disabled chip
// teaches nothing.

/** How long the window waits after a keystroke before asking. */
const LIBRARY_SETTLE = 300;

let asking = 0;

/**
 * Open the library for one mark, and remember which mark it is for.
 *
 * The mark rather than a copy of its kind: what gets chosen is written back onto it, and
 * a window that had only been told "a component" could not put the answer anywhere.
 */
function openLibrary(mark) {
  state.library = {
    markId: mark.id,
    kind: kindIdOf(mark),
    query: "",
    mine: true,
    loading: true,
    found: null,
    trouble: null,
  };
  state.open = null;
  render();
  void lookInLibrary();
}

function closeLibrary() {
  state.library = null;
  render();
}

/**
 * Ask the catalogue, and ignore an answer that arrived too late to be about the question.
 *
 * Typing produces one of these every few hundred milliseconds, and they come back out of
 * order — an answer to "pri" landing after the answer to "pricing" would replace the
 * results with worse ones while somebody watched.
 */
async function lookInLibrary() {
  const open = state.library;
  if (!open) return;
  const mine = open.mine;
  const asked = ++asking;
  open.loading = true;
  render();
  try {
    const found = await invoke("colai_library_search", {
      kind: open.kind,
      query: open.query,
      mine,
      agentId: state.receiving.kind === "agent" ? state.receiving.id : null,
      sessionKey: state.receiving.kind === "agent" ? null : state.receiving.id,
    });
    if (asked !== asking || !state.library) return;
    state.library.found = found;
    state.library.trouble = found.trouble || null;
  } catch (error) {
    if (asked !== asking || !state.library) return;
    state.library.found = null;
    state.library.trouble = error && error.message ? error.message : String(error);
  }
  if (state.library) state.library.loading = false;
  render();
}

let settling = null;
function lookLater() {
  if (settling !== null) clearTimeout(settling);
  settling = setTimeout(() => void lookInLibrary(), LIBRARY_SETTLE);
}

/** Take the choice back to the mark that asked for it, and close. */
function chooseFromLibrary(card) {
  const open = state.library;
  if (!open) return;
  const mark = state.marks.find((one) => one.id === open.markId);
  if (mark) {
    mark.source = "library";
    // Everything the message will need, kept on the mark rather than looked up again at
    // send time — the window will be closed by then and the search that found it gone.
    mark.fromLibrary = {
      id: card.id,
      name: card.name,
      library: (open.found && open.found.library) || "the library",
      url: card.url || null,
      install: card.install || null,
      preview: card.preview || null,
    };
  }
  state.library = null;
  // Back to the mark it belongs to, so the choice lands somewhere somebody can see it.
  if (mark) state.popup = mark.id;
  render();
}

function drawLibrary() {
  const open = state.library;
  el.library.hidden = open === null;
  if (!open) return;
  const kind = DESIGNS[open.kind] || DESIGNS[DESIGN_FIRST];

  const head = document.createElement("div");
  head.className = "library-head";
  const title = document.createElement("p");
  title.className = "agents-title";
  title.textContent = `${kind.label} — from a library`;
  head.append(title);
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "popup-shut";
  shut.title = "Close";
  shut.setAttribute("aria-label", "Close the library");
  shut.textContent = "×";
  shut.addEventListener("click", closeLibrary);
  head.append(shut);

  const find = document.createElement("input");
  find.className = "popup-note library-find";
  find.type = "text";
  find.value = open.query;
  find.placeholder = open.kind === "system" ? "A theme — dark, violet…" : "A component — pricing table…";
  find.setAttribute("aria-label", "Search the library");
  find.addEventListener("input", () => {
    open.query = find.value;
    lookLater();
  });

  // Two places to look, and yours first. Somebody who has collected components has
  // already done the choosing once, and making them search a public catalogue for a
  // thing they bookmarked is asking them to do it again.
  const where = document.createElement("div");
  where.className = "mode-row";
  for (const [mine, label] of [
    [true, "Yours"],
    [false, "Browse"],
  ]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", String(open.mine === mine));
    chip.textContent = label;
    chip.addEventListener("click", () => {
      open.mine = mine;
      void lookInLibrary();
    });
    where.append(chip);
  }

  const rows = [head, find, where];
  const found = open.found;
  if (open.loading) {
    rows.push(saying("Looking…"));
  } else if (found && found.connect) {
    // The one state this window exists to handle well. Not an error: nothing is broken,
    // there is simply nothing connected yet, and the only useful thing to say is where
    // to go and connect one.
    rows.push(
      saying(
        "No component library is connected to this agent yet. Add one in OpenClaw — " +
          "settings, then MCP servers — and its components and design systems will show " +
          "up here.",
      ),
    );
  } else if (open.trouble) {
    rows.push(saying(`Could not look — ${open.trouble}`));
  } else if (!found || found.cards.length === 0) {
    rows.push(saying(open.mine ? "Nothing saved here yet." : "Nothing matched."));
  } else {
    const grid = document.createElement("div");
    grid.className = "library-grid scrolls";
    for (const card of found.cards) grid.append(cardIn(card));
    rows.push(grid);
  }
  el.library.replaceChildren(...rows);
  placeLibrary();
}

/**
 * Put the window on the screen the mark is on, in the middle of it.
 *
 * Measured after it is filled, because how tall it is depends on how many results came
 * back — and a window placed from a guessed height sits off centre by however wrong the
 * guess was.
 */
function placeLibrary() {
  const open = state.library;
  if (!open) return;
  const mark = state.marks.find((one) => one.id === open.markId);
  // The middle of what was marked. A mark with no region — a pin — still has a point,
  // and a mark that has gone leaves the rail, which is at least somewhere somebody is.
  const at =
    mark && mark.region
      ? {
          x: (mark.region.box.x + mark.region.box.w / 2) * window.innerWidth,
          y: (mark.region.box.y + mark.region.box.h / 2) * window.innerHeight,
        }
      : state.at || { x: 0, y: 0 };
  const put = centredIn(usable(screenAt(state.screens, at)), el.library.getBoundingClientRect());
  el.library.style.left = `${put.x}px`;
  el.library.style.top = `${put.y}px`;
}

/** One thing to choose, as a picture with its name under it. */
function cardIn(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "library-card";
  button.title = card.blurb || card.name;

  const shot = document.createElement("div");
  shot.className = "library-shot";
  if (card.preview) {
    const picture = document.createElement("img");
    picture.src = card.preview;
    picture.alt = "";
    picture.loading = "lazy";
    // A catalogue's picture may be gone, and a broken-image glyph in a grid of previews
    // reads as a broken toolbar. The empty frame reads as a thing with no picture.
    picture.addEventListener("error", () => picture.remove());
    shot.append(picture);
  }
  button.append(shot);

  const name = document.createElement("span");
  name.className = "library-name";
  name.textContent = card.name;
  button.append(name);
  if (card.author) {
    const by = document.createElement("span");
    by.className = "row-under";
    by.textContent = card.author;
    button.append(by);
  }
  button.addEventListener("click", () => chooseFromLibrary(card));
  return button;
}
