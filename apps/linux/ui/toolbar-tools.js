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
  record: { label: "Recording", press: "R", glyph: "record", writes: false },
  compare: { label: "Before and after", press: "A", glyph: "compare", writes: false },
  inspect: { label: "Inspect", press: "I", glyph: "inspect", writes: false },
  watch: { label: "Watch", press: "W", glyph: "watch", writes: false },
  design: { label: "Design", glyph: "wireframe", writes: false },
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

/**
 * What a design mark is asking for.
 *
 * One tool with four things it can mean, rather than four keys: they take the same
 * picture of the same region and differ only in the sentence that goes with it, and a
 * rail with four near-identical eyes on it is a rail nobody can read. The kind is
 * picked in the popup, where somebody is already looking at what they marked.
 *
 * Data rather than branches, so the chips in the popup and the instruction in the
 * message are read from one place and cannot drift apart — the same reason `MODES` is
 * a table.
 *
 * `home` is where the document goes when nobody says otherwise, and a component has
 * none on purpose. Only the repository knows where its own components live, and a
 * toolbar that guessed would be sending an agent to the wrong directory with an air of
 * confidence.
 */
const DESIGNS = {
  wireframe: {
    label: "Wireframe",
    glyph: "wireframe",
    home: "docs/Design/",
    says: (file, home) =>
      `Turn ${file} into a wireframe and write it to ${home}, matching the .dc.html ` +
      `documents already there — the same <x-dc> wrapper and the shared _ds/ ` +
      `stylesheets they use.`,
  },
  redline: {
    label: "Redline",
    glyph: "redline",
    home: "docs/Design/",
    says: (file, home) =>
      `Measure ${file} and write the spec to ${home}: spacing between elements, type ` +
      `sizes and weights, colours as hex, border radii, and the states you can see. ` +
      `Where this project already has tokens for any of it, name the token rather ` +
      `than the value.`,
  },
  component: {
    label: "Component",
    glyph: "component",
    home: null,
    says: (file) =>
      `Build ${file} as a component in the framework this project already uses. Read ` +
      `its neighbours first and match how they are written, where they live, and how ` +
      `they are tested — a component that is correct and unlike everything around it ` +
      `is a component somebody has to rewrite.`,
  },
  system: {
    label: "Design system",
    // The one label too long for a chip beside four others. Said in full wherever
    // there is room for it, which is everywhere except the chip itself.
    chip: "System",
    glyph: "system",
    home: "docs/Design/",
    says: (file, home) =>
      `Build a design system out of ${file} and write it to ${home}. Cover the ` +
      `foundations first — colour, type scale, spacing, radii, elevation — then the ` +
      `components visible in it, then the patterns those components compose into. ` +
      `Write it the way Claude's own design language is written: plain sentences, a ` +
      `stated reason for each decision, and examples rather than rules. Where this ` +
      `project already decided something, record what it decided rather than what you ` +
      `would have chosen.`,
  },
  tokens: {
    label: "Tokens",
    glyph: "tokens",
    home: "docs/Design/",
    says: (file, home) =>
      `Pull the design tokens out of ${file} — colours, spacing steps, type scale, ` +
      `radii — and reconcile them with the ones this project already defines. Write ` +
      `what is new and what conflicts to ${home}; do not restate what already exists.`,
  },
};

/** Which kind a design mark is when nobody has said. */
const DESIGN_FIRST = "wireframe";

/** Where a design mark's document goes: what somebody typed, or the kind's own home. */
function homeOf(mark) {
  const kind = kindOf(mark);
  // A component has no default, so an empty field is a real answer there — "wherever
  // this project keeps them" — and the sentence for that kind never asks about it.
  return (mark.dest || "").trim() || kind.home || "";
}

/*
 * ── where a mark is ──────────────────────────────────────────────────────────
 *
 * A point on a screen means nothing to somebody who cannot see the screen. `x=1420,
 * y=880` is a fact about a desk, and an agent given it has to work out which
 * application, which page and which file before it can do anything — usually by asking,
 * which costs a turn, or by reading around, which costs tokens. Sending the address
 * with the picture is the whole saving.
 *
 * Three layers, and which layer a fact came from travels with it. An agent must never
 * be unable to tell something measured from something inferred:
 *
 *   known  — the desktop and the kernel said so. Application, window, size, working
 *            directory. Cannot be wrong.
 *   read   — worked out from the window title by the rules below. Usually right, and
 *            occasionally a title that merely looks like an editor's.
 *   asked  — the desktop answered a question about itself. A page's real URL, the
 *            element under the pointer. Absent whenever accessibility is switched off,
 *            which is most of the time.
 *
 * Everything below is the middle layer, and every rule in it would rather return
 * nothing than something plausible.
 */

/**
 * What a window title says about the file, project or page behind it.
 *
 * Titles are a convention rather than an interface, so each rule matches a shape that
 * only one kind of application produces and refuses everything else. A title with no
 * recognised shape yields nothing at all, which is the correct answer far more often
 * than any guess would be.
 */
function placeOf(front) {
  const title = ((front && front.title) || "").trim();
  if (!title) return {};
  const app = ((front && front.app) || "").toLowerCase();
  const exe = ((front && front.exe) || "").toLowerCase();
  const both = `${app} ${exe}`;

  // An editor: "file.ts — folder - Visual Studio Code", with a dot for unsaved work.
  // The em dash is what makes this shape safe to match — a page title containing " - "
  // is common and " — " between two path-ish words is not.
  const code = /^[●•*\s]*(.+?)\s+[—–]\s+(.+?)\s+-\s+(?:Visual Studio Code|VSCodium|Code - OSS)$/.exec(
    title,
  );
  if (code) return { file: code[1].trim(), project: code[2].trim() };

  // Sublime and friends: "file — folder", and nothing else on the line.
  const plain = /^(\S[^—–]*?)\s+[—–]\s+([^—–]+)$/.exec(title);
  if (plain && wordIn(both, "sublime")) {
    return { file: plain[1].trim(), project: plain[2].trim() };
  }

  // A browser puts the page title in front of its own name. The URL is not in there —
  // that is the layer above, and it is why the layer above exists.
  const browser = /^(.+?)\s+[—-]\s+(?:Mozilla Firefox|Google Chrome|Chromium|Brave|Microsoft Edge)$/.exec(
    title,
  );
  if (browser) return { page: browser[1].trim() };

  // A terminal: "someone@machine: ~/somewhere". The path is the half worth having.
  const shell = /^[^\s@]+@[^\s:]+:\s*(\S.*)$/.exec(title);
  if (shell) return { path: shell[1].trim() };

  // GNOME's editor: "file (~/folder) - Text Editor".
  const gedit = /^[●•*\s]*(.+?)\s+\((.+?)\)\s+-\s+(?:Text Editor|gedit)$/.exec(title);
  if (gedit) return { file: gedit[1].trim(), project: gedit[2].trim() };

  return {};
}

/**
 * The address of a mark, in the order somebody would say it out loud.
 *
 * Written as lines rather than a paragraph because an agent reads it as a lookup, and
 * because a fact that turned out to be unavailable has to be visibly missing rather
 * than quietly absent. Each line says which layer it came from where that is not
 * obvious; the ones with no note are the ones that cannot be wrong.
 */
function whereSaid(where) {
  if (!where || !where.app) return ["Somewhere on the screen — the desktop would not say."];
  const said = [];
  const place = placeOf(where);
  const head = [`In ${where.app}`];
  if (where.cwd) head.push(`— ${where.cwd}`);
  said.push(head.join(" "));
  if (where.url) said.push(`  ${where.url}`);
  const window = [];
  if (where.at) window.push(`window ${where.at.width}×${where.at.height}`);
  if (where.title) window.push(`"${where.title}"`);
  if (window.length) said.push(`  ${window.join(" · ")}`);
  if (place.file) {
    const of = place.project ? `${place.file} in ${place.project}` : place.file;
    said.push(`  file ${of} (read from the title)`);
  }
  if (place.path) said.push(`  path ${place.path} (read from the title)`);
  // A page with no address. Said rather than left out: an agent given a page title and
  // no URL knows it has to find the page, where one given nothing assumes there was
  // never a page to find. Measured on this desktop — holding an accessibility
  // connection open does not make browsers start answering; it has to be switched on.
  if (place.page && !where.url) {
    said.push(`  page "${place.page}" (read from the title — the URL was not available)`);
  }
  if (where.folder) said.push(`  folder ${where.folder}`);
  return said;
}

/**
 * Where a mark sits inside the window it was made over, in that window's own pixels.
 *
 * Not the desktop's. A desktop coordinate stops being true the moment somebody moves
 * the window, and it is meaningless to an agent that never saw the desk; a window
 * coordinate with the window's size beside it can be acted on.
 */
function spotIn(mark, where, screen) {
  if (!where || !where.at || !screen || !screen.width) return null;
  const of = (point) => ({
    x: Math.round(point.x * screen.width - where.at.x),
    y: Math.round(point.y * screen.height - where.at.y),
  });
  // Marking is not clicking. The window with the keyboard is usually the one somebody
  // is looking at, and occasionally they reach across and mark something else — so a
  // spot that falls outside the window is not a spot in that window, and offering it as
  // one would be the confident kind of wrong this whole idea exists to remove.
  const inside = (spot) =>
    spot.x >= 0 && spot.y >= 0 && spot.x <= where.at.width && spot.y <= where.at.height;
  if (mark.region) {
    const box = mark.region.box;
    const corner = of({ x: box.x, y: box.y });
    if (!inside(corner)) return null;
    return {
      ...corner,
      width: Math.round(box.w * screen.width),
      height: Math.round(box.h * screen.height),
    };
  }
  if (!mark.points || mark.points.length === 0) return null;
  const from = of(mark.points[0]);
  if (!inside(from)) return null;
  if (mark.points.length === 1) return from;
  const to = of(mark.points[mark.points.length - 1]);
  return { ...from, to };
}

/** That spot, in the words the message uses. */
function spotSaid(spot) {
  if (!spot) return null;
  if (typeof spot.width === "number") {
    return `at ${spot.x},${spot.y} · ${spot.width}×${spot.height}`;
  }
  if (spot.to) return `${spot.x},${spot.y} → ${spot.to.x},${spot.to.y}`;
  return `at ${spot.x},${spot.y}`;
}

/**
 * Whether two marks were made in the same place, and can share one address.
 *
 * By the window rather than the application: two windows of one editor are two
 * different files, and saying the address once for both would be saying it wrong.
 */
function samePlace(one, two) {
  if (!one || !two) return one === two;
  return one.id === two.id && one.title === two.title && one.url === two.url;
}

/**
 * Whether a mark's frames would rather arrive as one sheet than as a run of pictures.
 *
 * A recording, and only a recording. Eight frames of a screen cost about fifteen thousand
 * image tokens sent separately and under a thousand laid out in a grid — and the grid is
 * the better picture, because the sequence is visible at a glance instead of having to be
 * reassembled from eight unrelated images.
 *
 * A before-and-after is not on this list on purpose. It is two frames whose whole point is
 * comparing detail between them, and halving each one to fit a grid would spend exactly
 * the thing somebody made the mark for. Two pictures is also not a bill.
 */
function sheeted(mark) {
  return mark.tool === "record" && mark.frames > 1;
}

/** What a mark is called in the message: for a design mark, which kind it is. */
function labelOf(mark) {
  if (mark.tool === "design") return kindOf(mark).label;
  // "Draw" says nothing about what was drawn. An arrow points at something and a
  // highlighter runs over it, and an agent reading the message should be told which.
  if (mark.tool === "draw") return (PENS[mark.pen] || PENS[PEN_FIRST]).label;
  return TOOLS[mark.tool] ? TOOLS[mark.tool].label : mark.tool;
}

/** Which kind of design a mark is asking for, whatever it says or fails to say. */
function kindOf(mark) {
  return DESIGNS[mark.design] || DESIGNS[DESIGN_FIRST];
}

/**
 * How long a recording may cover.
 *
 * A short list rather than a slider: the choice is "a moment" or "long enough to go and
 * do the thing", and four steps say that where sixty would only make somebody pick one.
 * The frame count does not change with it — a longer recording spreads the same handful
 * further apart, because every frame is a picture an agent has to be sent.
 */
const RECORD_LENGTHS = [2, 5, 10, 15];

/**
 * How far outside a recorded region the toolbar may draw while recording it.
 *
 * The frames are the region plus `OUTLINE_ROOM` — twelve pixels of context, in
 * `src/colai_capture.rs` — and anything the overlay paints inside that lands in the
 * pictures. Sixteen is measured in CSS pixels against a crop measured in device ones,
 * so it clears twelve on a plain display and more on a dense one, whichever way the
 * scaling goes.
 *
 * Not a decoration budget: this number is why a recording of a flickering panel comes
 * back as the panel rather than as a red rectangle somebody drew around it.
 */
const RECORD_CLEAR = 16;

/*
 * ── automations ──────────────────────────────────────────────────────────────
 *
 * A send happens once. An automation is the same request on a schedule, and the
 * Gateway already has the machinery for it — this borrows its vocabulary rather than
 * inventing a second one, so a job made here reads the same in the Control UI as one
 * made there.
 *
 * Only what somebody has to decide. OpenClaw's own form keeps triggers, wake mode,
 * timeouts, delivery routes and tool allowances behind an "Advanced" fold; none of
 * that belongs on an overlay, and a panel that asked for it would be a settings page
 * standing on somebody's desktop.
 *
 * The one thing an automation cannot carry is the pictures. A scheduled job takes a
 * message and nothing else, so the words go and the photographs do not — which is said
 * out loud in the panel and written into the message, because an agent told to look at
 * `mark-1.png` that never arrives is worse off than one told there is no picture.
 */

/** How often an automation can repeat, in the Gateway's own words. */
const REPEATS = {
  every: { label: "Interval" },
  at: { label: "Once" },
  cron: { label: "Cron" },
};

/** The units an interval is offered in, and what each is worth. */
const UNITS = {
  minutes: { label: "Minutes", ms: 60_000 },
  hours: { label: "Hours", ms: 3_600_000 },
  days: { label: "Days", ms: 86_400_000 },
};

/** How an automation starts out: every thirty minutes, in a session of its own. */
const AUTOMATION_FIRST = {
  name: "",
  repeat: "every",
  amount: "30",
  unit: "minutes",
  at: "",
  expr: "0 9 * * *",
  tz: "",
  where: "isolated",
};

/**
 * The schedule an automation would be created with, or null if it is not one yet.
 *
 * Null rather than a guess: a blank interval and a half-typed cron expression are both
 * "not ready", and the panel would rather grey out its own button than post something
 * the Gateway will reject with a sentence nobody can act on.
 */
function scheduleOf(cron) {
  if (cron.repeat === "at") {
    const at = (cron.at || "").trim();
    return at ? { kind: "at", at } : null;
  }
  if (cron.repeat === "cron") {
    const expr = (cron.expr || "").trim();
    if (!expr) return null;
    const tz = (cron.tz || "").trim();
    return tz ? { kind: "cron", expr, tz } : { kind: "cron", expr };
  }
  const amount = Number(cron.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = UNITS[cron.unit] || UNITS.minutes;
  return { kind: "every", everyMs: Math.round(amount * unit.ms) };
}

/**
 * What the schedule comes to, in a sentence.
 *
 * Written where somebody can read it before they commit to it. "Every 30 minutes" is
 * a setting; "Runs every 30 minutes" is a promise, and the difference is whether
 * anybody notices they typed 30 into the days field.
 */
function scheduleSays(cron) {
  const schedule = scheduleOf(cron);
  if (!schedule) return null;
  if (schedule.kind === "at") return `Runs once at ${schedule.at}`;
  if (schedule.kind === "cron") {
    return schedule.tz
      ? `Cron schedule ${schedule.expr} (${schedule.tz})`
      : `Cron schedule ${schedule.expr}`;
  }
  const amount = Number(cron.amount);
  const unit = (UNITS[cron.unit] || UNITS.minutes).label.toLowerCase();
  return amount === 1 ? `Runs every ${unit.replace(/s$/, "")}` : `Runs every ${amount} ${unit}`;
}

/**
 * What an automation is called when nobody has named it.
 *
 * From the work rather than from the clock: "Every 30 minutes" is what the schedule
 * already says, and a list of jobs all called that is a list nobody can read.
 */
function nameFor(marks, text, surface) {
  const said = (text || "").trim() || (marks.find((mark) => (mark.note || "").trim()) || {}).note;
  const from = (said || "").trim().split("\n")[0];
  if (from) return from.length > 60 ? `${from.slice(0, 57)}…` : from;
  return surface && surface.app ? `Check ${surface.app}` : "Check the screen";
}

/**
 * What the agent reads every time the automation runs.
 *
 * Not the send message. That one names the pictures attached to it, and an automation
 * has none — a scheduled job carries a message and nothing more. Naming files that
 * will not arrive is the worst of both: the agent goes looking, finds nothing, and
 * reports that something is broken.
 */
function automationFor(marks, mode, text, surface) {
  const said = [];
  const asked = MODES[mode] || MODES.plan;
  said.push(`${asked.label}: ${asked.says}`);
  const own = (text || "").trim();
  if (own) {
    said.push("");
    said.push(own);
  }
  const notes = marks.map((mark) => (mark.note || "").trim()).filter(Boolean);
  if (notes.length) {
    said.push("");
    said.push(notes.length === 1 ? `About: ${notes[0]}` : `About: ${notes.join("; ")}`);
  }
  // The address, and not the coordinates. A scheduled run happens later, when the
  // window has been moved or closed; a point inside a window that no longer exists is
  // worse than no point, where "which project, which page" is still true tomorrow.
  const place = (marks.find((mark) => mark.where) || {}).where || surface;
  if (place && place.app) {
    said.push("");
    for (const line of whereSaid({ ...place, at: null })) said.push(line);
  }
  said.push("");
  said.push(
    "Set up from the colai toolbar. No pictures travel with a scheduled run, and the " +
      "screen will have moved on — go and look at what you need.",
  );
  return said.join("\n");
}

/**
 * How long the exact tools take to fold — the stylesheet's number, restated.
 *
 * The page has to know when the rail has stopped changing size so it can stop
 * re-measuring the clickable region, and CSS cannot tell it. Restated rather than
 * guessed, and the toolbar's test suite reads the duration back out of the stylesheet
 * to keep the two from drifting.
 */
const FOLD_TIME = 220;

/**
 * How long a run may go quiet before the toolbar stops claiming it is working.
 *
 * The net beneath `session.ended`. A terminal frame that never arrives — a gateway that
 * dropped, a session that went away — would otherwise leave the rail glowing about work
 * that is not happening, which is a worse lie than never having shown it.
 *
 * Generous, because a thinking agent is genuinely silent for minutes and a glow that
 * gives up on one is the same lie in the other direction.
 */
const RUN_QUIET = 4 * 60 * 1000;

/**
 * Which runs are still worth claiming are underway, given what has been heard and when.
 *
 * A pure decision over a list, so the rule about going quiet is a thing with a test on
 * it rather than a `setTimeout` somewhere that nobody can check.
 */
function stillRunning(runs, now) {
  return (runs || []).filter((run) => now - run.heard < RUN_QUIET);
}

/** What the rail says about work underway, in the fewest words that are still true. */
function runningSaid(runs) {
  if (!runs || runs.length === 0) return null;
  return runs.length === 1 ? "working" : `${runs.length} working`;
}

/** How far an opened answer sits from the pin it belongs to, on whichever side it fits. */
const ANSWER_AWAY = 18;

/**
 * Where an answer opens: beside its pin, on the side of it that fits.
 *
 * An answer used to open down and to the right at a fixed offset, which is fine in the
 * middle of a display and unreadable at the end of one — a reply about something near
 * the right edge ran off it, and the half nobody could see included the buttons for
 * agreeing with it.
 *
 * Flipped rather than nudged back. Sliding it onto the screen would put it under its
 * own pin, and the pin is what closes it again.
 *
 * `room` is the pin's own screen, not the desktop: the overlay spans every display, so
 * "there is space to the right" can mean "there is space on the next monitor", which
 * puts half a panel across a bezel.
 */
function answerAt(at, box, room) {
  // Beside the pin on one axis, then held inside the room on that axis anyway. The
  // second half is not belt and braces: a pin can sit *in* the strip a desktop has
  // reserved for its own panel — that is where somebody's dock is, and things worth
  // pointing at live there — and flipping away from a pin that is already past the edge
  // lands the panel back over the very thing the room excludes.
  const beside = (from, near, far, size) => {
    const put = from + ANSWER_AWAY + size <= far - EDGE ? from + ANSWER_AWAY : from - ANSWER_AWAY - size;
    // The near edge wins when the panel is wider than the room it has: the corner
    // somebody reads from first is the one that has to be on the display.
    return Math.max(near + EDGE, Math.min(put, far - EDGE - size));
  };
  return {
    left: beside(at.x, room.left, room.right, box.width),
    top: beside(at.y, room.top, room.bottom, box.height),
  };
}

/** Whole seconds left of a recording, never past its ends. */
function secondsLeft(until, now) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Where to draw the frame that shows what is being recorded, in fractions of the
 * display, given the region and how big the display is.
 *
 * Returned in fractions because that is what a mark is kept in and what the layer it
 * goes on is stretched to — and the clearance is in pixels, so the two have to meet
 * somewhere. Here.
 */
function recordFrame(box, screen) {
  const across = RECORD_CLEAR / Math.max(1, screen.width);
  const down = RECORD_CLEAR / Math.max(1, screen.height);
  const x = box.x - across;
  const y = box.y - down;
  return { x, y, w: box.w + across * 2, h: box.h + down * 2 };
}

/**
 * How much of a dropped file travels with the message, and how much of a whole send does.
 *
 * A file goes into the message base64-encoded, through one websocket frame, and comes
 * out the far end as bytes an agent has to be given. That is the right thing for a
 * screenshot, a log, a stylesheet — and the wrong thing for a video, an archive, or a
 * directory of them, which is why anything past these limits is named rather than
 * carried. Naming is not a failure: the receiving agent is usually on this machine and
 * can open the path itself, and the ones that cannot would not have survived the frame.
 */
const CARRY_FILE = 8 * 1024 * 1024;
const CARRY_SEND = 20 * 1024 * 1024;

/** A size somebody can read, rather than a number of bytes nobody can. */
function sizeOf(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Which of these travel with the message and which are only named, in order.
 *
 * In order, and not by size, because the order is the one somebody chose: dropping a
 * small file after a large one should not silently promote it past the file above it.
 * Every entry keeps a reason, so the composer can say why something is not coming
 * along rather than showing it greyed out and leaving somebody to guess.
 */
function carrying(files) {
  let room = CARRY_SEND;
  let full = false;
  return (files || []).map((file) => {
    if (file.folder) return { ...file, carried: false, why: "a folder" };
    // Its own size, before the budget, so a file nothing could have carried says the
    // real reason rather than blaming the files above it.
    if (file.bytes > CARRY_FILE) return { ...file, carried: false, why: sizeOf(file.bytes) };
    // Once the message is full it stays full, even if something further down would
    // have squeezed in. A list where the third file is named and the fourth is
    // attached is a rule nobody can see; a line drawn through it is one they can.
    if (full || file.bytes > room) {
      full = true;
      return { ...file, carried: false, why: "no room left" };
    }
    room -= file.bytes;
    return { ...file, carried: true, why: null };
  });
}

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
  design: "box",
  measure: "span",
  record: "box",
  compare: "box",
  watch: "box",
};

/**
 * What the drawing tool draws with.
 *
 * One key with four pens, picked by right-clicking it, the way the record key is asked
 * how long. They are all the same gesture — put the pointer down, move, let go — and
 * differ only in what is left behind, which is not four keys' worth of difference on a
 * rail this size.
 *
 * `kind` is what the shape becomes. Freehand and highlighter keep every point the hand
 * passed through; an arrow and a line keep two, because a line somebody drew wobbling
 * is not a line they meant.
 */
const PENS = {
  freehand: { label: "Freehand", glyph: "draw", kind: "stroke" },
  arrow: { label: "Arrow", glyph: "arrow", kind: "arrow" },
  line: { label: "Line", glyph: "line", kind: "line" },
  highlight: { label: "Highlighter", glyph: "highlight", kind: "highlight" },
};

/** Which pen the drawing tool starts with. */
const PEN_FIRST = "freehand";

/** The kinds that are a path somebody drew rather than an area they enclosed. */
const PATHS = ["stroke", "span", "arrow", "line", "highlight"];

/**
 * What a tool draws right now: its own kind, or — for the drawing tool — its pen's.
 *
 * The one tool whose shape is a setting rather than a fact about the key, which is why
 * `DRAWS` cannot answer this on its own.
 */
function kindFor(tool, pen) {
  if (tool !== "draw") return DRAWS[tool];
  return (PENS[pen] || PENS[PEN_FIRST]).kind;
}

/**
 * An arrowhead: how far back along its own line the barbs sit, how far out, and the
 * shortest and longest a head may be.
 *
 * A share of the arrow rather than a fixed size, so a short arrow does not arrive as a
 * head with a stub behind it — bounded at both ends, because a share of a very long
 * arrow is a head the size of a window.
 *
 * These four and `HIGHLIGHT_WIDE` are restated in `src/colai_capture.rs`, which draws
 * the same marks onto the picture that gets sent. They have to agree: what somebody
 * sees on the glass is a promise about what the agent will be looking at, and a preview
 * drawn to different numbers is a promise this toolbar quietly breaks. The test suite
 * reads the Rust side back out and compares.
 */
const ARROW_HEAD = 0.22;
const ARROW_WIDE = 0.42;
const ARROW_LEAST = 12;
const ARROW_MOST = 42;

/** How wide a highlighter lays down, in pixels of the display it is drawn on. */
const HIGHLIGHT_WIDE = 22;

/**
 * The two barbs of an arrowhead, as fractions of the display, given its line.
 *
 * Worked out in real pixels and converted back, because this layer is a unit square
 * stretched across the whole desktop: a head sized in those units is a different shape
 * on every screen, and square to the line comes out leaning.
 */
function headOf(from, to, screen) {
  const [dx, dy] = [(to.x - from.x) * screen.width, (to.y - from.y) * screen.height];
  const long = Math.hypot(dx, dy);
  if (long === 0) return null;
  const back = Math.min(Math.max(long * ARROW_HEAD, ARROW_LEAST), ARROW_MOST);
  const [ux, uy] = [dx / long, dy / long];
  // Back along the line, then out to either side of it.
  const [bx, by] = [to.x - (ux * back) / screen.width, to.y - (uy * back) / screen.height];
  const [sx, sy] = [
    (-uy * back * ARROW_WIDE) / screen.width,
    (ux * back * ARROW_WIDE) / screen.height,
  ];
  return [
    { x: bx + sx, y: by + sy },
    { x: bx - sx, y: by - sy },
  ];
}

/** The tools for which a click that selected nothing means the whole display. */
const WHOLE_DISPLAY = ["screenshot", "design"];

/** Single letters that pick a tool, from the tooltips the rail shows. */
const KEYS = {
  v: "pointer",
  p: "pointAt",
  d: "draw",
  b: "box",
  o: "circle",
  m: "measure",
  c: "colour",
  r: "record",
  a: "compare",
  i: "inspect",
  w: "watch",
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
function summaryFor(marks, mode, text, surface, files) {
  const said = [];
  const said_of = (mark, at) => {
    const note = (mark.note || "").trim();
    const detail = detailOf(mark);
    const files = sheeted(mark)
      ? `mark-${at + 1}.png, ${mark.frames} frames in order, left to right and top row first`
      : mark.frames > 1
        ? `mark-${at + 1}-1.png … mark-${at + 1}-${mark.frames}.png`
        : `mark-${at + 1}.png`;
    const spot = spotSaid(mark.spot);
    const named = `${at + 1}. ${labelOf(mark)} (${files})${spot ? ` ${spot}` : ""}`;
    return [named, detail, note].filter(Boolean).join(" — ");
  };
  if (marks.length) {
    // Grouped by where they were made, and the address said once per group. Repeating
    // it under every mark would spend more tokens than the whole idea saves, and two
    // marks made in two applications must not end up under one heading — which is what
    // a single surface read at send time used to do.
    let place = undefined;
    marks.forEach((mark, at) => {
      if (at === 0 || !samePlace(place, mark.where)) {
        place = mark.where;
        if (at > 0) said.push("");
        for (const line of whereSaid(place || surface)) said.push(line);
        // The window with the keyboard is usually the one somebody is looking at, and
        // occasionally they reach across and mark something else. Said, because an agent
        // that trusts the address over the picture would go and work on the wrong thing.
        if (place && place.at && !mark.spot) {
          said.push("  — but this was marked outside that window. Trust the picture.");
        }
        said.push("");
      }
      said.push(said_of(mark, at));
    });
    // A design mark asks for a file rather than an opinion, so it says what to make and
    // where it goes. Stated per mark: two of them in one batch are two documents, not
    // one with two names — and they can be two different kinds.
    marks.forEach((mark, at) => {
      if (mark.tool !== "design") return;
      const kind = kindOf(mark);
      said.push("");
      said.push(kind.says(`mark-${at + 1}.png`, homeOf(mark)));
    });
    said.push("");
  }
  // What came in from the file system, split by whether it could travel. Both halves
  // are worth saying: an agent that knows a path was named rather than attached knows
  // to go and read it, where one told nothing waits for a picture that never arrives.
  const brought = carrying(files);
  const along = brought.filter((file) => file.carried);
  const named = brought.filter((file) => !file.carried);
  if (along.length) {
    said.push(along.length === 1 ? "One file is attached:" : `${along.length} files are attached:`);
    said.push("");
    for (const file of along) said.push(`- ${file.name} (${sizeOf(file.bytes)}) — ${file.path}`);
    said.push("");
  }
  if (named.length) {
    said.push("Not attached. Read these where they are, on the machine this came from:");
    said.push("");
    for (const file of named) said.push(`- ${file.path} (${file.why})`);
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
  if (shape.kind === "arrow") {
    // Drawn as one path so the halo behind it in the picture follows the head as well
    // as the shaft — a shaft with a floating outline round it is worse than no outline.
    const [from, to] = [points[0], points[points.length - 1]];
    const line = `M${from.x} ${from.y}L${to.x} ${to.y}`;
    const head = headOf(from, to, shape.screen || { width: 1, height: 1 });
    if (!head) return line;
    return `${line}M${head[0].x} ${head[0].y}L${to.x} ${to.y}L${head[1].x} ${head[1].y}`;
  }
  if (PATHS.includes(shape.kind)) {
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
 * The project the window in front belongs to, if it is obvious which.
 *
 * The toolbar already knows what is in front and already knows every conversation's
 * checkout; nothing connected the two, so the most repeated act in using this was
 * telling it something it could see. An editor's title says which repository is open —
 * "toolbar.js — colai — Visual Studio Code" — and that is the name to match.
 *
 * It guesses at nothing. A name has to appear as a word, so a project called `ui` does
 * not claim every window with "build" in the title; two projects matching equally well
 * means no answer at all, because picking one of them is worse than asking. Being wrong
 * here sends somebody's work to the wrong conversation.
 */
function projectInFront(projects, front) {
  const said = `${(front && front.title) || ""} ${(front && front.app) || ""}`.toLowerCase();
  if (!said.trim()) return null;
  let best = null;
  let bestAt = 0;
  let tied = false;
  for (const project of projects || []) {
    const name = ownName(project);
    // Two characters match half the desktop. A repository is not usually called `go`,
    // and if it is, choosing the receiver by hand is the safer cost.
    if (!name || name.length < 3) continue;
    if (!wordIn(said, name)) continue;
    if (name.length > bestAt) {
      best = project;
      bestAt = name.length;
      tied = false;
    } else if (name.length === bestAt) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** A project's own name: the last part of its label, which may carry a parent. */
function ownName(project) {
  const label = (project && project.label) || "";
  return label.split("/").filter(Boolean).pop() || "";
}

/** Whether a name appears in a title as a word rather than inside another one. */
function wordIn(said, name) {
  let at = said.indexOf(name);
  while (at !== -1) {
    const before = at === 0 ? " " : said[at - 1];
    const after = at + name.length >= said.length ? " " : said[at + name.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    at = said.indexOf(name, at + 1);
  }
  return false;
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
  // What the desktop said was there, when it was willing to say. The wording matters:
  // an agent told nothing about structure knows it is reading pixels, where an agent
  // told something vague does not.
  if (mark.tool === "inspect") {
    return mark.seen ? saidOf(mark.seen) : "this window exposes no structure";
  }
  // A recording says how long it covers, because a run of pictures with no duration is
  // just pictures. A comparison says nothing here: its own name is "Before and after",
  // and the two files in order say the rest.
  // The length is carried on the mark rather than computed from the frame count,
  // because the count is capped and the length is not: two seconds and fifteen are the
  // same eight pictures, spread further apart.
  if (mark.tool === "record" && mark.frames > 1 && typeof mark.seconds === "number") {
    return `${mark.frames} frames over ${Math.round(mark.seconds * 10) / 10}s`;
  }
  // A watch says what happened to it, because nobody was there when it did. Its two
  // pictures are the same region before and after, and without this line they are a
  // pair of screenshots with no account of why they arrived.
  if (mark.tool === "watch" && mark.frames > 1) {
    return "this changed while it was being watched — the first picture is before";
  }
  return null;
}

/**
 * One element, as a sentence.
 *
 * Role first, because that is the part a picture cannot be read for; the name next,
 * because that is what a person would call it; then where it sits, because "Button"
 * alone says nothing about which button.
 */
function saidOf(seen) {
  const called = seen.name ? `${seen.role} “${seen.name}”` : seen.role;
  const [x, y, width, height] = seen.at;
  const where = width && height ? `${width}×${height} at ${x},${y}` : `at ${x},${y}`;
  const within = (seen.within || []).length ? `, in ${seen.within.join(" in ")}` : "";
  return `${called}, ${where}${within}`;
}

/** A count with its noun, so the rail reads as a sentence rather than a gauge. */
function counted(many, noun) {
  return `${many} ${noun}${many === 1 ? "" : "s"}`;
}
