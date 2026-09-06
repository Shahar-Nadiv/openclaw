// The toolbar's decisions, with nothing of the browser in them.
//
// Kept apart from the page so a Node test can run the whole file as-is rather than
// slicing it at a boundary comment and hoping the cut stays in the right place. What
// lives here is everything that can be decided without a screen: which tools exist and
// what each one means, what an agent is actually sent, where the rail belongs, and
// whether a tool may do what it is about to.

/**
 * The tools, and which of them ask a surface to change.
 *
 * The second column is the whole point. Reading is universal — the toolbar can mark and
 * describe anything on screen — and *changing* something is only possible where a
 * connector owns the surface. A tool that writes and a tool that only marks are
 * different in kind, so that difference is data here rather than a branch buried in a
 * handler.
 *
 * Nothing writes yet, and that is not the column going unused. Creating a wireframe
 * asks an agent to write a document; it never reaches into the application that was
 * pointed at, and calling it a write would have the gate refuse a tool that was never
 * going to touch the surface. The column means what it says, and the first tool that
 * genuinely changes somebody's window will be refused by it until a connector owns
 * that window.
 */
const TOOLS = {
  pointer: { label: "Pointer", press: "V", glyph: "pointer", writes: false },
  pointAt: { label: "Point at", press: "P", glyph: "pointAt", writes: false },
  draw: { label: "Draw", press: "D", glyph: "draw", writes: false },
  box: { label: "Box", press: "B", glyph: "box", writes: false },
  circle: { label: "Circle", press: "O", glyph: "circle", writes: false },
  measure: { label: "Measure", press: "M", glyph: "measure", writes: false },
  colour: { label: "Colour", press: "C", glyph: "colour", writes: false },
  wireframe: { label: "Create wireframe", glyph: "wireframe", writes: false },
  screenshot: { label: "Screenshot", glyph: "screenshot", writes: false },
};

/**
 * What a batch of marks is being sent *for*.
 *
 * The instruction an agent is given changes what comes back more than anything else in
 * the message, and it is the one thing somebody should not have to type again every
 * time. Data rather than branches, so the chips on the composer and the sentence in the
 * message are read from the same place and cannot drift apart.
 */
const MODES = {
  ask: { label: "Ask", says: "Answer the question. Do not change anything yet." },
  plan: {
    label: "Plan",
    says: "Work out what needs to change and lay out the steps. Do not edit anything yet.",
  },
  debug: {
    label: "Debug",
    says: "Work out why this is happening, and read the code before concluding anything.",
  },
  build: { label: "Build", says: "Make this change." },
};

/** Where a wireframe goes when nobody says otherwise. */
const WIREFRAME_HOME = "docs/Design/";

/**
 * What each tool draws while it is being dragged, if anything.
 *
 * A screenshot and a wireframe drag out a region like any other area tool. Released
 * without having moved, they mean the whole display — the one gesture where a click
 * that selected nothing is a request rather than a slip.
 */
const DRAWS = {
  box: "box",
  circle: "ellipse",
  draw: "stroke",
  screenshot: "box",
  wireframe: "box",
  measure: "span",
};

/** The tools for which a click that selected nothing means the whole display. */
const WHOLE_DISPLAY = ["screenshot", "wireframe"];

/** Single letters that pick a tool, from the tooltips the rail shows. */
const KEYS = {
  v: "pointer",
  p: "pointAt",
  d: "draw",
  b: "box",
  o: "circle",
  m: "measure",
  c: "colour",
};

/**
 * What the agent actually reads.
 *
 * The pictures carry what a region looks like. This carries what was meant by it: which
 * tool made each mark, what was written on it, and what the whole batch is for. Numbered
 * to match the order the pictures are attached in, because an agent looking at three
 * images needs to know which sentence belongs to which one, and "the second thing" is
 * not an answer when the images arrive as a set.
 *
 * The instruction goes last. Everything above it is what is being talked about, and the
 * last line is what to do — the same order a person would say it out loud.
 */
function summaryFor(marks, mode, text, surface) {
  const said = [];
  const said_of = (mark, at) => {
    const tool = TOOLS[mark.tool];
    const note = (mark.note || "").trim();
    const detail = detailOf(mark);
    const named = `${at + 1}. ${tool ? tool.label : mark.tool} (mark-${at + 1}.png)`;
    return [named, detail, note].filter(Boolean).join(" — ");
  };
  if (marks.length) {
    const where = (surface && surface.app) || "screen";
    said.push(
      marks.length === 1
        ? `One thing marked on ${where}:`
        : `${marks.length} things marked on ${where}:`,
    );
    said.push("");
    marks.forEach((mark, at) => said.push(said_of(mark, at)));
    // A wireframe is the one mark that asks for a file rather than an opinion, so it
    // says where the file goes. Stated per mark: two of them in one batch are two
    // documents, not one with two names.
    marks.forEach((mark, at) => {
      if (mark.tool !== "wireframe") return;
      const home = (mark.dest || "").trim() || WIREFRAME_HOME;
      said.push("");
      said.push(
        `Turn mark-${at + 1}.png into a wireframe and write it to ${home}, matching the ` +
          `.dc.html documents already there — the same <x-dc> wrapper and the shared _ds/ ` +
          `stylesheets they use.`,
      );
    });
    said.push("");
  }
  const asked = MODES[mode] || MODES.plan;
  said.push(`${asked.label}: ${asked.says}`);
  const own = (text || "").trim();
  if (own) {
    said.push("");
    said.push(own);
  }
  return said.join("\n");
}

/**
 * How close to an edge counts as docked.
 *
 * Wide enough that somebody aiming for the edge hits it, narrow enough that a rail
 * parked near the side is not dragged into an orientation change it was not asked for.
 */
const DOCK_WITHIN = 80;
/** How far the hand has to leave an edge before the rail gives that edge up. */
const DOCK_LEAVE = 120;
/** How much nearer a rival edge has to be before it takes a dock over. */
const DOCK_BEAT = 24;
/** How far a docked rail sits from the edge of the room it has. */
const EDGE = 14;

const NOTHING_RESERVED = { top: 0, right: 0, bottom: 0, left: 0 };

function isVertical(dock) {
  return dock === "left" || dock === "right";
}

/**
 * The part of a screen the toolbar may use.
 *
 * Not the whole screen. A desktop's own panels — GNOME's top bar, Ubuntu's dock — are
 * drawn by the compositor above every window, so a toolbar docked flush to a screen edge
 * disappears underneath one. Keeping out of them is the only arrangement where both stay
 * visible.
 *
 * Per screen, because the overlay covers the whole desk and the desk is not one screen.
 * The shell's panel is along the top of one display and nowhere near the other; four
 * numbers for the desk as a whole would either lose the panel or reserve a strip of a
 * screen that has none.
 */
function usable(screen) {
  const edges = (screen && screen.reserved) || NOTHING_RESERVED;
  return {
    left: screen.x + edges.left,
    top: screen.y + edges.top,
    right: screen.x + screen.width - edges.right,
    bottom: screen.y + screen.height - edges.bottom,
  };
}

/**
 * Which screen something is on.
 *
 * The nearest one when it is on none — a desk of two displays that do not line up has
 * gaps between and beside them, and a point in a gap still has to belong somewhere or
 * the rail has no edges to dock to.
 */
function screenAt(screens, at) {
  if (!screens || screens.length === 0) return null;
  const holding = screens.find(
    (screen) =>
      at.x >= screen.x &&
      at.x < screen.x + screen.width &&
      at.y >= screen.y &&
      at.y < screen.y + screen.height,
  );
  if (holding) return holding;
  return screens.reduce((best, screen) => (awayFrom(screen, at) < awayFrom(best, at) ? screen : best));
}

/** How far a point is from a screen's box, zero when it is inside it. */
function awayFrom(screen, at) {
  const across = Math.max(screen.x - at.x, 0, at.x - (screen.x + screen.width));
  const down = Math.max(screen.y - at.y, 0, at.y - (screen.y + screen.height));
  return Math.hypot(across, down);
}

/**
 * Which edge a drag is claiming, decided from the hand rather than from the rail.
 *
 * The rail's own box cannot answer this. A horizontal rail is around 480 wide and a
 * vertical one around 44, so a gap measured from the box depends on the answer the box
 * already has — dock to the right, turn, and the gap that decided it is suddenly 400px
 * wider, so it undocks, turns back, and docks again. That ran at pointer speed and read
 * as the toolbar shivering in the corner.
 *
 * The hand is the one thing in this that nothing here moves, so distances come from it,
 * and two margins make the answer decisive. An edge is not given up until the hand is
 * well clear of it, and a rival has to be meaningfully nearer before it takes over —
 * so in a corner, where two edges are both within reach, the toolbar commits to one and
 * stays there until you plainly mean the other.
 */
function dockFor(at, screens, was) {
  const screen = screenAt(screens, at);
  if (!screen) return null;
  const room = usable(screen);
  const gaps = {
    left: at.x - room.left,
    right: room.right - at.x,
    top: at.y - room.top,
    bottom: room.bottom - at.y,
  };
  // Ties keep the earlier edge, so a corner has one answer rather than two.
  const nearest = Object.keys(gaps).reduce((best, edge) =>
    gaps[edge] < gaps[best] ? edge : best,
  );
  const held = was && was in gaps;
  if (held && gaps[was] <= DOCK_LEAVE) {
    return gaps[nearest] + DOCK_BEAT < gaps[was] ? nearest : was;
  }
  return gaps[nearest] < DOCK_WITHIN ? nearest : null;
}

/** The smallest box containing every point, in fractions of the surface. */
function boxOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** An SVG path for a gesture, in the 0..1 space the marks layer draws in. */
function pathFor(shape) {
  if (!shape || shape.points.length === 0) return "";
  const points = shape.points;
  if (shape.kind === "stroke" || shape.kind === "span") {
    // A span is a stroke of exactly two points. It is drawn without end ticks on
    // purpose: this layer is a unit square stretched to the screen, so anything meant
    // to be square to the line comes out leaning.
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  }
  const box = boxOf(points);
  if (shape.kind === "ellipse") {
    const rx = box.w / 2;
    const ry = box.h / 2;
    const cx = box.x + rx;
    const cy = box.y + ry;
    // Two arcs, because a single one cannot close a full ellipse.
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }
  return `M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`;
}

/**
 * Whether a tool may do what it is about to do.
 *
 * Reading is universal — the toolbar can mark and describe anything on screen — and
 * changing something is only possible where a connector owns that surface. Refusing is
 * not a failure reported politely: it is the product working, and the sentence says so,
 * because "nothing happened" and "the region was noticed and deliberately left alone"
 * are different things to be told.
 *
 * It answers only when the answer is no. An allowed action needs no narration; it just
 * happens, and the thing that happens is the feedback.
 */
function gateFor(tool, surface) {
  const known = TOOLS[tool];
  if (!known || !known.writes || (surface && surface.connector)) {
    return { blocked: false, says: null };
  }
  return {
    blocked: true,
    says: `${(surface && surface.app) || "That app"} isn't connected. Region noted, nothing changed.`,
  };
}

/**
 * How far apart two points are, in the pixels somebody would count.
 *
 * The overlay thinks in fractions of itself so a mark survives the rail moving between
 * screens, and a fraction is not an answer to "how big is this gap". The screen turns
 * it back into the number a stylesheet is written in — which is the entire reason the
 * tool exists, because a picture can be looked at and cannot be measured.
 */
function spanOf(points, screen) {
  if (!points || points.length < 2) return 0;
  const [from, to] = [points[0], points[points.length - 1]];
  const across = (to.x - from.x) * screen.width;
  const down = (to.y - from.y) * screen.height;
  return Math.round(Math.hypot(across, down));
}

/**
 * What a mark carries beyond its picture.
 *
 * Most marks are a region and nothing else — the image says everything. Two of them
 * know something exact that no image can be read for, and this is where that reaches
 * the agent: a distance in pixels, and a colour as the six digits somebody would paste
 * into a stylesheet.
 */
function detailOf(mark) {
  if (mark.tool === "measure" && typeof mark.px === "number") {
    return `${mark.px}px apart`;
  }
  if (mark.tool === "colour" && mark.hex) return mark.hex;
  return null;
}

/** A count with its noun, so the rail reads as a sentence rather than a gauge. */
function counted(many, noun) {
  return `${many} ${noun}${many === 1 ? "" : "s"}`;
}
