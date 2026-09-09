// Exercises the pure decisions extracted from the Linux toolbar webview script.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it as test } from "vitest";

/*
 * The whole file, not a slice of one.
 *
 * These decisions used to live above a boundary comment in the page and were cut out of
 * it by index, which meant the test quietly measured whatever happened to be above that
 * line. They have a file of their own now, and it has nothing of the browser in it, so
 * running all of it is the honest thing to do.
 */
const toolbarSource = readFileSync(
  new URL("../apps/linux/ui/toolbar-tools.js", import.meta.url),
  "utf8",
);
assert.ok(toolbarSource.includes("function summaryFor"), "toolbar decisions file");

/*
 * The Rust half of two rules this file also owns.
 *
 * What a mark is about — which pixels get cropped, and whether the shape is drawn back
 * onto them — is decided in `colai_marks.rs`, and the page has to agree with it. Neither
 * language can check the other at compile time, so the numbers and the list are read out
 * of the source that enforces them rather than restated here.
 */
const marksSource = readFileSync(
  new URL("../apps/linux/src-tauri/src/colai_marks.rs", import.meta.url),
  "utf8",
);
assert.ok(marksSource.includes("fn crop_for"), "the mark geometry file");

type Point = { x: number; y: number };
type Reserved = { top: number; right: number; bottom: number; left: number };
type Screen = { x: number; y: number; width: number; height: number; reserved?: Reserved };
type Surface = { app: string; connector: string | null } | null;

type ToolbarHelpers = {
  TOOLS: Record<string, { label: string; writes: boolean }>;
  DRAWS: Record<string, string>;
  dockFor: (at: Point, screens: Screen[], was?: string | null) => string | null;
  usable: (screen: Screen) => { left: number; top: number; right: number; bottom: number };
  screenAt: (screens: Screen[], at: Point) => Screen | null;
  boxOf: (points: Point[]) => { x: number; y: number; w: number; h: number };
  pathFor: (
    shape: { kind: string; points: Point[]; screen?: { width: number; height: number } } | null,
  ) => string;
  gateFor: (tool: string, surface: Surface) => { blocked: boolean; says: string | null };
  counted: (many: number, noun: string) => string;
  MODES: Record<string, { label: string; says: string }>;
  spanOf: (points: Point[], screen: { width: number; height: number }) => number;
  projectInFront: (
    projects: { label: string | null; path?: string }[],
    front: { app?: string; title?: string } | null,
  ) => { label: string | null } | null;
  detailOf: (mark: {
    tool: string;
    px?: number;
    hex?: string;
    frames?: number;
    seconds?: number;
    seen?: { role: string; name: string; at: number[]; within?: string[] } | null;
  }) => string | null;
  summaryFor: (
    marks: {
      tool: string;
      note?: string;
      dest?: string;
      px?: number;
      hex?: string;
      frames?: number;
      seconds?: number;
      design?: string;
      pen?: string;
      where?: Front | null;
      spot?: Spot | null;
      source?: string;
      fromLibrary?: Chosen | null;
    }[],
    mode: string,
    text: string,
    surface: Surface,
    files?: Brought[],
  ) => string;
  RECORD_LENGTHS: number[];
  carrying: (
    files: Brought[] | undefined,
  ) => (Brought & { carried: boolean; why: string | null })[];
  sizeOf: (bytes: number) => string;
  secondsLeft: (until: number, now: number) => number;
  recordFrame: (
    box: { x: number; y: number; w: number; h: number },
    screen: { width: number; height: number },
  ) => { x: number; y: number; w: number; h: number };
  RECORD_CLEAR: number;
  DESIGNS: Record<
    string,
    {
      label: string;
      chip?: string;
      glyph?: string;
      home: string | null;
      says: (file: string, home: string) => string;
      /** Only the kinds that can be brought in rather than copied. */
      brings?: (file: string, home: string, chosen: Chosen) => string;
    }
  >;
  DESIGN_FIRST: string;
  labelOf: (mark: { tool: string; design?: string; pen?: string }) => string;
  homeOf: (mark: { design?: string; dest?: string }) => string;
  WHOLE_DISPLAY: string[];
  scheduleOf: (cron: Cron) => Record<string, unknown> | null;
  scheduleSays: (cron: Cron) => string | null;
  nameFor: (marks: { note?: string }[], text: string, surface: Surface) => string;
  automationFor: (
    marks: { tool: string; note?: string; where?: Front | null; spot?: Spot | null }[],
    mode: string,
    text: string,
    surface: Surface,
  ) => string;
  AUTOMATION_FIRST: Cron;
  UNITS: Record<string, { label: string; ms: number }>;
  REPEATS: Record<string, { label: string }>;
  FOLD_TIME: number;
  PENS: Record<string, { label: string; glyph: string; kind: string }>;
  PEN_FIRST: string;
  PATHS: string[];
  kindFor: (tool: string, pen?: string) => string | undefined;
  ARROW_HEAD: number;
  ARROW_WIDE: number;
  ARROW_LEAST: number;
  ARROW_MOST: number;
  HIGHLIGHT_WIDE: number;
  placeOf: (front: Front | null) => Place;
  whereSaid: (where: Front | null) => string[];
  spotIn: (
    mark: { region?: { box: Box } | null; points?: Point[] },
    where: Front | null,
    screen: { width: number; height: number },
  ) => Spot | null;
  spotSaid: (spot: Spot | null) => string | null;
  samePlace: (one: Front | null, two: Front | null) => boolean;
  stillRunning: (runs: Run[] | undefined, now: number) => Run[];
  runsNow: (runs: Run[] | undefined, work: Work | null, now: number) => Run[];
  runningSaid: (runs: Run[] | undefined) => string | null;
  RUN_QUIET: number;
  sheeted: (mark: { tool: string; frames?: number }) => boolean;
  asksSomething: (said: string) => boolean;
  rewindRefused: (said: unknown, sessionKey?: string) => string;
  canGoBack: (
    row: { kind: string; id?: string; sessionKey?: string } | null,
    allowed: string[] | undefined,
  ) => { can: boolean; why: string | null };
  pointSaid: (
    point: { said?: string; at?: number | null },
    now: number,
  ) => { words: string; when: string | null };
  agoSaid: (at: number, now: number) => string;
  REWIND_SAYS: string;
  KEEPS_MARKING: string[];
  MOODS: Record<string, { colour: string; says: (many: number) => string }>;
  moodOf: (work: Work | null) => { mood: string; many: number } | null;
  moodSaid: (work: Work | null) => string;
  moodMark: (work: Work | null) => string | null;
  SOURCES: Record<string, { label: string; says: string }>;
  TAKES_SOURCE: string[];
  sourceOf: (mark: { design?: string; source?: string; fromLibrary?: Chosen | null }) => string;
  broughtIn: (mark: {
    design?: string;
    source?: string;
    fromLibrary?: Chosen | null;
  }) => Chosen | null;
  centredIn: (
    room: { left: number; top: number; right: number; bottom: number },
    box: { width: number; height: number },
  ) => { x: number; y: number };
  FOLLOWS_WINDOW: string[];
  anchorOf: (where: Front | null) => Anchor | null;
  intoWindow: (box: Placed, at: Rect, screen: Size) => Placed;
  ontoScreen: (box: Placed, at: Rect, screen: Size) => Placed;
  showingNow: (
    mark: { tool: string; on?: Anchor | null },
    front: InFront | null,
    look?: { tool?: string; showing?: boolean },
  ) => boolean;
  entrySaid: (entry: { said?: string; shots?: unknown[] }) => string;
  asDrawn: (mark: Held, front: InFront | null, screen: Size) => Held;
  unchosen: (
    marks: { tool: string; design?: string; source?: string; fromLibrary?: Chosen | null }[],
  ) => string | null;
  numberOf: (
    marks: { tool?: string; chosen?: boolean }[] | undefined,
    mark: { tool?: string; chosen?: boolean } | null | undefined,
  ) => number | null;
};

/** A run the toolbar believes is underway. */
type Run = { sessionKey: string; who?: string; heard: number };

/** Where a mark was made, as the toolbar gathers it. */
type Front = {
  app?: string;
  title?: string;
  id?: string;
  cwd?: string;
  exe?: string;
  url?: string;
  folder?: string;
  at?: { x: number; y: number; width: number; height: number } | null;
};
type Place = { file?: string; project?: string; page?: string; path?: string };
type Box = { x: number; y: number; w: number; h: number };
type Spot = { x: number; y: number; width?: number; height?: number; to?: Point };

/** The automation being written, as the panel holds it. */
type Cron = {
  name: string;
  repeat: string;
  amount: string;
  unit: string;
  at: string;
  expr: string;
  tz: string;
  where: string;
};

/** A file or folder somebody dropped on the toolbar, as the page holds it. */
type Brought = { path: string; name: string; bytes: number; folder: boolean };

/** What every agent on the Gateway adds up to, as the light reads it. */
type Work = { running: number; waiting: number; trouble: number };

/** A window's rectangle, and the sizes a mark is expressed against. */
type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
/** A point, or a point with a size — the conversions take either. */
type Placed = { x: number; y: number; w?: number; h?: number };

/** What a mark is attached to, and what the desktop says is in front of it now. */
type Anchor = { id: string; at: Rect; title: string | null; url: string | null };
/** A mark as the page holds it, with the two fields drawing reads. */
type Held = {
  tool: string;
  on?: Anchor | null;
  inside?: { box: Placed | null; points: Placed[] } | null;
  region?: { box: Placed } | null;
  points?: Placed[];
};

type InFront = {
  id?: string;
  title?: string | null;
  url?: string | null;
  /** Where that window is now, which is what a mark is drawn from. */
  at?: Rect | null;
  ours?: boolean;
};

/** What somebody picked out of a catalogue, as the mark carries it. */
type Chosen = {
  id: string;
  name: string;
  library: string;
  url?: string | null;
  install?: string | null;
};

const context: { helpers?: ToolbarHelpers } & Record<string, unknown> = {};
vm.runInNewContext(
  `${toolbarSource}\nthis.helpers = { TOOLS, DRAWS, dockFor, usable, boxOf, pathFor, gateFor, counted, MODES, summaryFor, screenAt, spanOf, detailOf, projectInFront, RECORD_LENGTHS, carrying, sizeOf, secondsLeft, recordFrame, RECORD_CLEAR, DESIGNS, DESIGN_FIRST, labelOf, homeOf, WHOLE_DISPLAY, scheduleOf, scheduleSays, nameFor, automationFor, AUTOMATION_FIRST, UNITS, REPEATS, FOLD_TIME, PENS, PEN_FIRST, PATHS, kindFor, ARROW_HEAD, ARROW_WIDE, ARROW_LEAST, ARROW_MOST, HIGHLIGHT_WIDE, placeOf, whereSaid, spotIn, spotSaid, samePlace, stillRunning, runsNow, runningSaid, RUN_QUIET, sheeted, asksSomething, canGoBack, rewindRefused, pointSaid, agoSaid, REWIND_SAYS, KEEPS_MARKING, numberOf, MOODS, moodOf, moodSaid, moodMark, SOURCES, TAKES_SOURCE, sourceOf, broughtIn, unchosen, centredIn, FOLLOWS_WINDOW, anchorOf, intoWindow, ontoScreen, showingNow, asDrawn, entrySaid };`,
  context,
);
const {
  TOOLS,
  DRAWS,
  dockFor,
  usable,
  boxOf,
  pathFor,
  gateFor,
  counted,
  MODES,
  summaryFor,
  screenAt,
  spanOf,
  detailOf,
  projectInFront,
  RECORD_LENGTHS,
  carrying,
  sizeOf,
  secondsLeft,
  recordFrame,
  RECORD_CLEAR,
  DESIGNS,
  DESIGN_FIRST,
  labelOf,
  homeOf,
  WHOLE_DISPLAY,
  scheduleOf,
  scheduleSays,
  nameFor,
  automationFor,
  AUTOMATION_FIRST,
  UNITS,
  REPEATS,
  FOLD_TIME,
  PENS,
  PEN_FIRST,
  PATHS,
  kindFor,
  ARROW_HEAD,
  ARROW_WIDE,
  ARROW_LEAST,
  ARROW_MOST,
  HIGHLIGHT_WIDE,
  placeOf,
  whereSaid,
  spotIn,
  spotSaid,
  samePlace,
  stillRunning,
  runsNow,
  runningSaid,
  RUN_QUIET,
  sheeted,
  asksSomething,
  canGoBack,
  rewindRefused,
  pointSaid,
  agoSaid,
  REWIND_SAYS,
  KEEPS_MARKING,
  numberOf,
  MOODS,
  moodOf,
  moodSaid,
  moodMark,
  SOURCES,
  TAKES_SOURCE,
  sourceOf,
  broughtIn,
  unchosen,
  centredIn,
  FOLLOWS_WINDOW,
  anchorOf,
  intoWindow,
  ontoScreen,
  showingNow,
  asDrawn,
  entrySaid,
} = context.helpers as ToolbarHelpers;

/*
 * No shipped tool changes a surface yet, so the gate has nothing to refuse — and the
 * gate is the product's whole thesis, which makes "untested because unused" the wrong
 * answer. This is the tool the first real one will be: it writes, and everything below
 * asks the gate what happens to it.
 */
TOOLS.surfaceWrite = { label: "Surface write", writes: true };

describe("what a tool is allowed to do", () => {
  // The whole point of the toolbar: it reads anything and changes only what a connector
  // owns. That difference is data so this test and the rail read the same list.
  test("nothing writes yet, because nothing yet reaches into somebody's window", () => {
    // Creating a wireframe asks an agent to write a document. It never touches the
    // application that was pointed at, so calling it a write would have the gate refuse
    // a tool that was never going to change a surface.
    for (const tool of Object.keys(TOOLS)) {
      if (tool === "surfaceWrite") {
        continue;
      }
      expect(TOOLS[tool]!.writes, tool).toBe(false);
    }
  });

  test("every drawing tool has a shape, and the pointer has none", () => {
    expect(DRAWS.box).toBe("box");
    expect(DRAWS.circle).toBe("ellipse");
    expect(DRAWS.draw).toBe("stroke");
    expect(DRAWS.pointer).toBeUndefined();
    // Both photographing tools drag out a region like any other area tool.
    expect(DRAWS.screenshot).toBe("box");
    expect(DRAWS.design).toBe("box");
  });
});

describe("the gate", () => {
  const connected: Surface = { app: "Figma", connector: "canvas-bridge" };
  const bare: Surface = { app: "Notes", connector: null };

  test("a write on an unconnected surface is refused and says so", () => {
    const said = gateFor("surfaceWrite", bare);
    expect(said.blocked).toBe(true);
    expect(said.says).toContain("Notes isn't connected");
    // The sentence the product turns on: the region was noticed, and nothing changed.
    expect(said.says).toContain("Region noted, nothing changed");
  });

  test("not knowing what is in front is not permission", () => {
    expect(gateFor("surfaceWrite", null).blocked).toBe(true);
  });

  test("marking works everywhere, connector or not", () => {
    expect(gateFor("pointAt", bare).blocked).toBe(false);
    expect(gateFor("box", null).blocked).toBe(false);
  });

  test("a write through a connector is allowed, and says nothing about it", () => {
    const said = gateFor("surfaceWrite", connected);
    expect(said.blocked).toBe(false);
    // An allowed action needs no narration. The thing happening is the feedback.
    expect(said.says).toBeNull();
  });

  test("asking for a design is not refused, because it changes no surface", () => {
    // It asks an agent for a document. Refusing it on an unconnected window would be
    // the gate answering a question nobody asked.
    expect(gateFor("design", bare).blocked).toBe(false);
  });
});

describe("where the rail sits", () => {
  const laptop = { x: 0, y: 0, width: 1920, height: 1080 };
  const desk = { x: 1920, y: 0, width: 1920, height: 1080 };
  const one = [laptop];
  const both = [laptop, desk];

  test("docks to whichever edge the hand is nearest", () => {
    expect(dockFor({ x: 12, y: 400 }, one)).toBe("left");
    expect(dockFor({ x: 1910, y: 400 }, one)).toBe("right");
    expect(dockFor({ x: 500, y: 20 }, one)).toBe("top");
    expect(dockFor({ x: 500, y: 1060 }, one)).toBe("bottom");
    expect(dockFor({ x: 900, y: 500 }, one)).toBeNull();
  });

  /*
   * The overlay covers the whole desk, and the desk is not one screen. Docking to the
   * outer edges of everything would mean the inner edge of either display — where a
   * person actually parks a toolbar on a two-screen desk — could not be reached at all,
   * and the top of the desk is under the shell's panel on one screen and empty air on
   * the other.
   */
  test("docks to the screen it is over, not to the edges of the desk", () => {
    // Just inside the second screen's left edge: its own edge, not the middle of nowhere.
    expect(dockFor({ x: 1930, y: 500 }, both)).toBe("left");
    // And the first screen's right edge is still an edge, though the desk continues.
    expect(dockFor({ x: 1910, y: 500 }, both)).toBe("right");
  });

  /*
   * A desktop's own panels are drawn above every window by the compositor, so a rail
   * docked flush to a screen edge is simply hidden under one. Measuring from the room
   * that is left is what keeps both visible — and the panel belongs to its own screen.
   */
  test("measures edges from the room that screen has", () => {
    const panelled = [laptop, { ...desk, reserved: { top: 32, right: 0, bottom: 0, left: 66 } }];
    expect(usable(panelled[1]!)).toEqual({
      left: 1986,
      top: 32,
      right: 3840,
      bottom: 1080,
    });
    // Both screens dock to their own top, and the two tops are not the same line: on
    // the panelled one the rail lands below the shell's bar, on the other at the very
    // edge. One number for the whole desk could only have been right for one of them.
    expect(dockFor({ x: 2400, y: 60 }, panelled)).toBe("top");
    expect(dockFor({ x: 400, y: 40 }, panelled)).toBe("top");
    expect(usable(panelled[0]!).top).toBe(0);
    expect(usable(panelled[1]!).top).toBe(32);
  });

  test("a point in a gap between screens still belongs to one", () => {
    // Displays need not touch. A hand in the gap has to dock somewhere, and the nearest
    // screen is the only answer that is not arbitrary.
    const apart = [laptop, { x: 2200, y: 0, width: 1920, height: 1080 }];
    expect(screenAt(apart, { x: 2000, y: 500 })).toBe(apart[0]);
    expect(screenAt(apart, { x: 2150, y: 500 })).toBe(apart[1]);
    expect(screenAt([], { x: 0, y: 0 })).toBeNull();
  });

  /*
   * The bug this margin exists for: a horizontal rail is ten times wider than a vertical
   * one, so an answer measured from the rail changes the next answer, and the toolbar
   * flipped orientation at pointer speed in a corner. These say the decision holds
   * still while the hand does.
   */
  test("a dock survives a wobble that a fresh decision would not", () => {
    expect(dockFor({ x: 100, y: 400 }, one, "left")).toBe("left");
    expect(dockFor({ x: 400, y: 400 }, one, "left")).toBeNull();
  });

  test("a corner commits to one edge instead of shivering between two", () => {
    expect(dockFor({ x: 30, y: 24 }, one, "left")).toBe("left");
    expect(dockFor({ x: 60, y: 8 }, one, "left")).toBe("top");
    expect(dockFor({ x: 24, y: 24 }, one)).toBe("left");
  });

  test("leaving one edge hands over to another it landed on", () => {
    expect(dockFor({ x: 700, y: 1070 }, one, "left")).toBe("bottom");
  });
});

describe("turning a gesture into a region", () => {
  test("a box is the extent of its points, in fractions", () => {
    expect(
      boxOf([
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ]),
    ).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  });

  test("a stroke draws through every point it kept", () => {
    const d = pathFor({
      kind: "stroke",
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
      ],
    });
    expect(d).toBe("M0 0 L0.5 0.5");
  });

  test("a box closes and an ellipse is two arcs", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
    ];
    expect(pathFor({ kind: "box", points })).toBe("M0 0h0.5v0.25h-0.5Z");
    // One arc cannot close a full ellipse; the second is not decoration.
    expect(pathFor({ kind: "ellipse", points }).match(/a/g)).toHaveLength(2);
  });

  test("an empty gesture draws nothing rather than a broken path", () => {
    expect(pathFor(null)).toBe("");
    expect(pathFor({ kind: "stroke", points: [] })).toBe("");
  });
});

describe("who the rail says can receive", () => {
  // The rail carries both counts in a few characters, so the wording is the whole
  // affordance: "1 agents" reads as a bug in the toolbar rather than a fact about
  // the machine.
  test("counts read as English, singular included", () => {
    expect(counted(1, "agent")).toBe("1 agent");
    expect(counted(11, "session")).toBe("11 sessions");
    expect(counted(0, "session")).toBe("0 sessions");
  });
});

describe("what the agent is actually sent", () => {
  const surface = { app: "Openclaw Desktop", connector: null };

  test("marks are numbered to match the pictures attached with them", () => {
    const said = summaryFor(
      [{ tool: "box", note: "this padding is wrong" }, { tool: "pointAt" }],
      "plan",
      "",
      surface,
    );
    expect(said).toContain("In Openclaw Desktop");
    // The number, the tool and the file name travel together, because three images
    // arriving as a set are only tellable apart by their names.
    expect(said).toContain("1. Box (mark-1.png) — this padding is wrong");
    expect(said).toContain("2. Point at (mark-2.png)");
  });

  test("the message opens with where it happened, before what happened", () => {
    // The address is what an agent needs first: which application, and from there
    // everything else. It used to be a count and an app name on one line, which said
    // how many but not where.
    expect(summaryFor([{ tool: "circle" }], "ask", "", surface)).toContain("In Openclaw Desktop");
  });

  test("the instruction comes last, and what you wrote comes after it", () => {
    const said = summaryFor(
      [{ tool: "box" }],
      "debug",
      "only when the panel is collapsed",
      surface,
    );
    const lines = said.split("\n").filter(Boolean);
    expect(lines.at(-2)).toBe(`Debug: ${MODES.debug!.says}`);
    expect(lines.at(-1)).toBe("only when the panel is collapsed");
  });

  test("a design mark says what to make and where, once each", () => {
    const said = summaryFor(
      [{ tool: "design", dest: "docs/Design/rail.dc.html" }, { tool: "design" }],
      "build",
      "",
      surface,
    );
    expect(said).toContain(
      "Turn mark-1.png into a wireframe and write it to docs/Design/rail.dc.html",
    );
    // The second one had no path, so it falls back rather than borrowing the first's.
    expect(said).toContain("Turn mark-2.png into a wireframe and write it to docs/Design/,");
  });

  test("with nothing marked it is still a sendable instruction", () => {
    const said = summaryFor([], "ask", "what does the rail do?", null);
    expect(said).not.toContain("marked on");
    expect(said).toBe(`Ask: ${MODES.ask!.says}\n\nwhat does the rail do?`);
  });

  test("not knowing where you are is said, not invented", () => {
    expect(summaryFor([{ tool: "box" }], "plan", "", null)).toContain("the desktop would not say");
  });
});

describe("the two tools that know a number", () => {
  const screen = { width: 1920, height: 1080 };

  test("a span is the distance on the screen, not in the overlay's fractions", () => {
    // The overlay thinks in fractions so a mark survives the rail moving to another
    // display. A fraction is not an answer to "how big is this gap".
    expect(
      spanOf(
        [
          { x: 0.1, y: 0.5 },
          { x: 0.2, y: 0.5 },
        ],
        screen,
      ),
    ).toBe(192);
    expect(
      spanOf(
        [
          { x: 0.5, y: 0.1 },
          { x: 0.5, y: 0.2 },
        ],
        screen,
      ),
    ).toBe(108);
    // Diagonals are the distance somebody would measure, not the sum of the sides.
    expect(
      spanOf(
        [
          { x: 0, y: 0 },
          { x: 0.1, y: 0.1 },
        ],
        screen,
      ),
    ).toBe(Math.round(Math.hypot(192, 108)));
  });

  test("a span of one point or none is no distance rather than a crash", () => {
    expect(spanOf([{ x: 0.5, y: 0.5 }], screen)).toBe(0);
    expect(spanOf([], screen)).toBe(0);
  });

  test("only the marks that know something exact carry a detail", () => {
    expect(detailOf({ tool: "measure", px: 148 })).toBe("148px apart");
    expect(detailOf({ tool: "colour", hex: "#3b82f6" })).toBe("#3b82f6");
    // A region says everything in its picture; there is nothing to add.
    expect(detailOf({ tool: "box" })).toBeNull();
    // And a tool that should know one but does not says nothing rather than guessing.
    expect(detailOf({ tool: "measure" })).toBeNull();
    expect(detailOf({ tool: "colour" })).toBeNull();
  });

  test("the detail reaches the agent between the picture and the note", () => {
    const said = summaryFor(
      [
        { tool: "measure", px: 13, note: "should be on the 8px grid" },
        { tool: "colour", hex: "#3b82f6" },
      ],
      "plan",
      "",
      { app: "Figma", connector: null },
    );
    expect(said).toContain("1. Measure (mark-1.png) — 13px apart — should be on the 8px grid");
    expect(said).toContain("2. Colour (mark-2.png) — #3b82f6");
  });
});

describe("marks that are more than one picture", () => {
  test("a recording says how many frames and how long they cover", () => {
    // The duration is what makes it a recording rather than a pile of screenshots.
    expect(detailOf({ tool: "record", frames: 8, seconds: 2 })).toBe("8 frames over 2s");
  });

  test("a longer recording is the same frames over longer, and says so", () => {
    // The frame count is capped, so length is carried rather than computed from it: a
    // fifteen-second recording that claimed to be two would be worse than no detail,
    // because an agent reading "8 frames over 2s" would time the change from it.
    expect(detailOf({ tool: "record", frames: 8, seconds: 15 })).toBe("8 frames over 15s");
  });

  test("a length that did not come out round is rounded, not printed in full", () => {
    // The frames are taken on a timer against a live desktop, so the span they actually
    // cover is never exactly the number somebody picked.
    expect(detailOf({ tool: "record", frames: 8, seconds: 5.043 })).toBe("8 frames over 5s");
  });

  test("the lengths on offer stop at fifteen seconds", () => {
    // A cap, not a habit: past this the frames are so far apart that what comes back is
    // a slideshow of a screen rather than a recording of a thing happening on it.
    expect(RECORD_LENGTHS[0]).toBe(2);
    expect(Math.max(...RECORD_LENGTHS)).toBe(15);
  });

  test("one frame is not a sequence", () => {
    expect(detailOf({ tool: "record", frames: 1, seconds: 2 })).toBeNull();
    expect(detailOf({ tool: "box", frames: 1 })).toBeNull();
  });

  test("the message names a run as one sheet and says how to read it", () => {
    const said = summaryFor(
      [{ tool: "record", frames: 6, seconds: 2 }, { tool: "box" }],
      "debug",
      "",
      { app: "Figma", connector: null },
    );
    expect(said).toContain(
      "1. Recording (mark-1.png, 6 frames in order, left to right and top row first)",
    );
    // A mark that photographed once keeps the plain name it always had.
    expect(said).toContain("2. Box (mark-2.png)");
  });
});

describe("the project in front of you", () => {
  const projects = [
    { label: "Desktop/colai", path: "/home/someone/Desktop/colai" },
    { label: "renti", path: "/home/someone/renti" },
    { label: "ui", path: "/home/someone/ui" },
  ];

  test("an editor's title names the repository it has open", () => {
    const found = projectInFront(projects, {
      title: "toolbar.js — colai — Visual Studio Code",
      app: "Code",
    });
    expect(found?.label).toBe("Desktop/colai");
  });

  test("a project's own name is matched, not the parent carried for uniqueness", () => {
    // The label reads "Desktop/colai" only because another checkout shares its name.
    // "Desktop" is not what an editor puts in its title.
    expect(projectInFront(projects, { title: "Desktop", app: "Files" })).toBeNull();
  });

  test("a short name does not claim half the desktop", () => {
    // `ui` appears inside "building", "quicksilver", and most other words.
    expect(projectInFront(projects, { title: "building the guide", app: "Code" })).toBeNull();
  });

  test("a name has to be a word, not a fragment of one", () => {
    expect(projectInFront(projects, { title: "rentier accounts", app: "Code" })).toBeNull();
    expect(projectInFront(projects, { title: "renti — README", app: "Code" })?.label).toBe("renti");
  });

  test("two equally good answers is no answer", () => {
    // Sending somebody's work to the wrong conversation is worse than asking them.
    const twins = [
      { label: "one/build", path: "/a/one/build" },
      { label: "two/build", path: "/b/two/build" },
    ];
    expect(projectInFront(twins, { title: "build — Code", app: "Code" })).toBeNull();
  });

  test("nothing in front is not a guess", () => {
    expect(projectInFront(projects, null)).toBeNull();
    expect(projectInFront(projects, { title: "", app: "" })).toBeNull();
    expect(projectInFront([], { title: "colai", app: "Code" })).toBeNull();
  });
});

describe("files somebody brought in", () => {
  const file = (name: string, bytes: number, folder = false) => ({
    path: `/home/someone/${name}`,
    name,
    bytes,
    folder,
  });

  /** Whether each of these travels, and what it was told if it does not. */
  const fates = (files: Brought[]) => carrying(files).map((one) => [one.carried, one.why] as const);

  test("a small file travels with the message", () => {
    expect(fates([file("notes.md", 400)])).toEqual([[true, null]]);
  });

  test("a folder is never carried, because there is nothing to carry", () => {
    // A directory has no bytes to encode. Naming it is not a lesser outcome — an agent
    // on this machine opens the path, which is what somebody dropping a project means.
    expect(fates([file("colai", 900_000_000, true)])).toEqual([[false, "a folder"]]);
  });

  test("a file too big for a message is named with its size, not just refused", () => {
    // The size is the reason, so the reason is what it says. "Could not attach" leaves
    // somebody wondering whether the file is broken.
    expect(fates([file("demo.mp4", 40 * 1024 * 1024)])).toEqual([[false, "40 MB"]]);
  });

  test("the send fills up, and what fills it is decided in the order it was dropped", () => {
    // Not by size, and not resumed once the message is full: a list where the third
    // file is named and the fourth is attached is a rule nobody can see. The tiny file
    // at the end would have fitted, and is named anyway, so the line through the list
    // stays a line.
    expect(
      fates([
        file("a.bin", 7 * 1024 * 1024),
        file("b.bin", 7 * 1024 * 1024),
        file("c.bin", 7 * 1024 * 1024),
        file("d.txt", 10),
      ]),
    ).toEqual([
      [true, null],
      [true, null],
      [false, "no room left"],
      [false, "no room left"],
    ]);
  });

  test("nothing brought in is not an error", () => {
    expect(carrying(undefined)).toEqual([]);
    expect(carrying([])).toEqual([]);
  });

  test("a size reads as a size", () => {
    expect(sizeOf(400)).toBe("400 B");
    expect(sizeOf(4096)).toBe("4 KB");
    expect(sizeOf(3_500_000)).toBe("3.3 MB");
  });

  test("the message says what is attached and what is only named, and why", () => {
    const said = summaryFor([], "ask", "", { app: "Files", connector: null }, [
      file("notes.md", 400),
      file("colai", 900_000_000, true),
    ]);
    expect(said).toContain("One file is attached:");
    expect(said).toContain("- notes.md (400 B) — /home/someone/notes.md");
    expect(said).toContain(
      "Not attached. Read these where they are, on the machine this came from:",
    );
    expect(said).toContain("- /home/someone/colai (a folder)");
  });

  test("a send with no files says nothing about files", () => {
    const said = summaryFor([{ tool: "box" }], "ask", "", { app: "Files", connector: null }, []);
    expect(said).not.toContain("attached");
    expect(said).not.toContain("Not attached");
  });
});

describe("what a recording shows while it runs", () => {
  /*
   * What the capture adds around a region, read out of the capture itself.
   *
   * The overlay draws the recording frame in the page and the crop is decided in Rust,
   * so the two halves of "do not photograph your own outline" live in different
   * languages and cannot check each other at compile time. Reading the number from its
   * own source is what stops a change on one side from silently putting a red rectangle
   * into every frame of every recording on the other.
   */
  const room = /const OUTLINE_ROOM: f64 = ([\d.]+);/.exec(marksSource);
  assert.ok(room, "OUTLINE_ROOM in colai_marks.rs");
  const OUTLINE_ROOM = Number(room[1]);

  test("the frame clears the pixels the pictures are taken from", () => {
    // The whole reason this number exists. A frame drawn a pixel too close comes back
    // in every frame of the recording, and a recording of a red rectangle somebody drew
    // is not a recording of the thing inside it.
    const screen = { width: 1920, height: 1080 };
    const box = { x: 0.25, y: 0.3, w: 0.2, h: 0.1 };
    const frame = recordFrame(box, screen);
    expect((box.x - frame.x) * screen.width).toBeGreaterThan(OUTLINE_ROOM);
    expect((box.y - frame.y) * screen.height).toBeGreaterThan(OUTLINE_ROOM);
    expect((frame.x + frame.w - (box.x + box.w)) * screen.width).toBeGreaterThan(OUTLINE_ROOM);
    expect((frame.y + frame.h - (box.y + box.h)) * screen.height).toBeGreaterThan(OUTLINE_ROOM);
  });

  test("the clearance is the same number of pixels on any size of display", () => {
    // Kept in pixels and converted, not kept as a fraction: a fraction that clears the
    // crop on a laptop is four pixels on a wall, and four pixels is inside it.
    for (const screen of [
      { width: 1280, height: 800 },
      { width: 3840, height: 2160 },
    ]) {
      const frame = recordFrame({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, screen);
      expect((0.5 - frame.x) * screen.width).toBeCloseTo(RECORD_CLEAR, 6);
      expect((0.5 - frame.y) * screen.height).toBeCloseTo(RECORD_CLEAR, 6);
    }
  });

  test("a region against the edge keeps its frame, even off the screen", () => {
    // Clamping it would draw the frame *on* the region, which puts it in the pictures.
    // Off the edge it is simply not seen on that side, which costs nothing.
    const frame = recordFrame({ x: 0, y: 0, w: 0.1, h: 0.1 }, { width: 1920, height: 1080 });
    expect(frame.x).toBeLessThan(0);
    expect(frame.y).toBeLessThan(0);
  });

  test("the countdown counts whole seconds and stops at nought", () => {
    // Rounded up, so a recording with any time left on it never reads as finished.
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    // A capture that runs past its length — the frames are taken against a live
    // desktop — shows nought rather than counting into negative numbers.
    expect(secondsLeft(10_000, 12_500)).toBe(0);
  });
});

describe("the design family", () => {
  test("three kinds, one tool", () => {
    // One key with three meanings rather than three keys: they take the same picture of
    // the same region and differ only in the sentence that goes with it, and a rail
    // with three near-identical eyes on it is a rail nobody can read.
    expect(Object.keys(DESIGNS)).toEqual(["wireframe", "component", "system"]);
    expect(TOOLS.design!.writes).toBe(false);
    expect(TOOLS.wireframe).toBeUndefined();
    expect(DESIGNS[DESIGN_FIRST]).toBeDefined();
  });

  test("every kind says something an agent could act on without being asked twice", () => {
    // The instruction is the whole difference between the kinds, so an empty or
    // interchangeable one would make its chip a lie.
    const said = Object.values(DESIGNS).map((kind) => kind.says("mark-1.png", "docs/Design/"));
    for (const line of said) {
      expect(line).toContain("mark-1.png");
      expect(line.length).toBeGreaterThan(80);
    }
    expect(new Set(said).size).toBe(said.length);
  });

  test("a label too long for a chip is short on the chip and long everywhere else", () => {
    // The message and the popup title have room for "Design system"; a chip beside four
    // others does not, and truncating it there would lose the word that says which one.
    expect(DESIGNS.system!.label).toBe("Design system");
    expect(DESIGNS.system!.chip).toBe("System");
    expect(labelOf({ tool: "design", design: "system" })).toBe("Design system");
    // Every other kind is short enough to say the same thing twice.
    for (const [id, kind] of Object.entries(DESIGNS)) {
      if (id !== "system") {
        expect(kind.chip).toBeUndefined();
      }
    }
  });

  test("every kind is on the menu under its own mark", () => {
    // The whole family used to hide behind one row called "Design", with the choice in
    // the popup that opened after you had already marked something — so somebody
    // looking for a design system opened the menu, did not see one, and concluded the
    // toolbar could not do it. Each kind names itself now, and needs an icon to do so.
    const rail = readFileSync(new URL("../apps/linux/ui/toolbar-rail.js", import.meta.url), "utf8");
    const drawn = new Set(
      [...rail.matchAll(/^ {2}(\w+):$|^ {2}(\w+):\s*'/gm)].map((found) => found[1] ?? found[2]),
    );
    for (const [id, kind] of Object.entries(DESIGNS)) {
      expect(kind.glyph, id).toBeTruthy();
      expect(drawn.has(kind.glyph!), `${id} wears ${kind.glyph}`).toBe(true);
    }
    // And no two of them wear the same one, or the menu is five rows saying one thing.
    const marks = Object.values(DESIGNS).map((kind) => kind.glyph);
    expect(new Set(marks).size).toBe(marks.length);
  });

  test("a component has no home, because only the repository knows where they live", () => {
    // A guessed path is worse than none: it sends an agent to the wrong directory with
    // an air of confidence, and its sentence never mentions a destination at all.
    expect(DESIGNS.component!.home).toBeNull();
    expect(homeOf({ design: "component" })).toBe("");
    expect(DESIGNS.component!.says("mark-1.png", "")).not.toContain("write it to ");
  });

  test("a kind that writes a document has somewhere to put it", () => {
    expect(homeOf({ design: "wireframe" })).toBe("docs/Design/");
    expect(homeOf({ design: "system" })).toBe("docs/Design/");
    // And what somebody typed beats it, for any kind.
    expect(homeOf({ design: "system", dest: " ui/spec.md " })).toBe("ui/spec.md");
    expect(homeOf({ design: "component", dest: "src/ui/" })).toBe("src/ui/");
  });

  test("a design mark with no kind is a wireframe rather than a mistake", () => {
    // Marks are made by dragging, not by filling in a form, so every field has to have
    // an answer before anybody has been asked for one.
    expect(labelOf({ tool: "design" })).toBe("Wireframe");
    expect(homeOf({})).toBe("docs/Design/");
    expect(summaryFor([{ tool: "design" }], "ask", "", null)).toContain("into a wireframe");
  });

  test("the message calls a mark by its kind, not by the tool that made it", () => {
    // "1. Design" says nothing; the kind is the request. And the tray uses the same
    // word, so what somebody ticks and what the agent reads match.
    expect(labelOf({ tool: "design", design: "system" })).toBe("Design system");
    const said = summaryFor(
      [
        { tool: "design", design: "system" },
        { tool: "design", design: "component" },
      ],
      "ask",
      "",
      null,
    );
    expect(said).toContain("1. Design system (mark-1.png)");
    expect(said).toContain("2. Component (mark-2.png)");
  });

  test("two design marks in one send are two documents, each said once", () => {
    const said = summaryFor(
      [
        { tool: "design", design: "wireframe", dest: "docs/Design/rail.dc.html" },
        { tool: "design", design: "component" },
      ],
      "plan",
      "",
      null,
    );
    expect(said).toContain(
      "Turn mark-1.png into a wireframe and write it to docs/Design/rail.dc.html",
    );
    expect(said).toContain("Build mark-2.png as a component");
    expect(said.match(/into a wireframe/g)).toHaveLength(1);
  });

  test("not dragging one out still asks for the whole screen", () => {
    // The simplest thing this tool does — "make me a wireframe of this screen" — has to
    // survive being asked for with a click.
    expect(WHOLE_DISPLAY).toContain("design");
    expect(WHOLE_DISPLAY).toContain("screenshot");
  });
});

describe("scheduling what was marked", () => {
  const cron = (over: Partial<Cron> = {}): Cron => ({ ...AUTOMATION_FIRST, ...over });

  test("it starts as something that would work if you pressed Create", () => {
    // A panel that opens invalid makes somebody solve a puzzle before they can do the
    // obvious thing. Every thirty minutes, in a session of its own, is the obvious thing.
    expect(scheduleOf(cron())).toEqual({ kind: "every", everyMs: 30 * 60_000 });
    expect(AUTOMATION_FIRST.where).toBe("isolated");
  });

  test("an interval is counted in whatever unit was picked", () => {
    expect(scheduleOf(cron({ amount: "2", unit: "hours" }))).toEqual({
      kind: "every",
      everyMs: 2 * 3_600_000,
    });
    expect(scheduleOf(cron({ amount: "1", unit: "days" }))).toEqual({
      kind: "every",
      everyMs: 86_400_000,
    });
  });

  test("half-written is not a schedule, and says so rather than guessing", () => {
    // Null is what greys the Create button out. Posting a guess would come back as a
    // Gateway rejection nobody can act on, one round trip later.
    expect(scheduleOf(cron({ amount: "" }))).toBeNull();
    expect(scheduleOf(cron({ amount: "0" }))).toBeNull();
    expect(scheduleOf(cron({ amount: "-5" }))).toBeNull();
    expect(scheduleOf(cron({ amount: "soon" }))).toBeNull();
    expect(scheduleOf(cron({ repeat: "at", at: "" }))).toBeNull();
    expect(scheduleOf(cron({ repeat: "cron", expr: "  " }))).toBeNull();
    expect(scheduleSays(cron({ amount: "" }))).toBeNull();
  });

  test("a timezone is sent only when there is one", () => {
    // An empty string is not "the host timezone", it is an empty string, and the
    // schema would take it as one.
    expect(scheduleOf(cron({ repeat: "cron", expr: "0 9 * * *", tz: "" }))).toEqual({
      kind: "cron",
      expr: "0 9 * * *",
    });
    expect(
      scheduleOf(cron({ repeat: "cron", expr: "0 9 * * *", tz: " Europe/Amsterdam " })),
    ).toEqual({ kind: "cron", expr: "0 9 * * *", tz: "Europe/Amsterdam" });
  });

  test("the schedule is said back as a sentence before it is agreed to", () => {
    // "Every 30" is a setting; "Runs every 30 minutes" is a promise, and the difference
    // is whether anybody notices they typed 30 into the days field.
    expect(scheduleSays(cron())).toBe("Runs every 30 minutes");
    expect(scheduleSays(cron({ amount: "1", unit: "hours" }))).toBe("Runs every hour");
    expect(scheduleSays(cron({ amount: "1", unit: "days" }))).toBe("Runs every day");
    expect(scheduleSays(cron({ repeat: "at", at: "2026-09-08T09:00" }))).toBe(
      "Runs once at 2026-09-08T09:00",
    );
    expect(scheduleSays(cron({ repeat: "cron", expr: "0 9 * * *" }))).toBe(
      "Cron schedule 0 9 * * *",
    );
  });

  test("it borrows the Gateway's own words for the choices", () => {
    // A job made here is listed beside jobs made in the Control UI. Calling the same
    // thing something else on this surface would make them look like two features.
    expect(Object.values(REPEATS).map((one) => one.label)).toEqual(["Interval", "Once", "Cron"]);
    expect(Object.values(UNITS).map((one) => one.label)).toEqual(["Minutes", "Hours", "Days"]);
  });

  test("an automation is named after the work, not after the clock", () => {
    // "Every 30 minutes" is what the schedule already says, and a list of jobs all
    // called that is a list nobody can read.
    expect(nameFor([], "Tell me if this goes red.", null)).toBe("Tell me if this goes red.");
    expect(nameFor([{ note: "the build status" }], "", null)).toBe("the build status");
    expect(nameFor([], "", { app: "Firefox", connector: null })).toBe("Check Firefox");
    expect(nameFor([], "", null)).toBe("Check the screen");
  });

  test("a long first line is cut rather than sent whole", () => {
    const said = nameFor([], "x".repeat(200), null);
    expect(said.length).toBeLessThanOrEqual(60);
    expect(said.endsWith("…")).toBe(true);
  });

  test("what runs never names a picture, because none of them travel", () => {
    // The worst version of this bug is silent: an agent told to look at mark-1.png goes
    // looking, finds nothing, and reports that something is broken.
    const said = automationFor(
      [{ tool: "box", note: "the build status" }],
      "debug",
      "Tell me if this goes red.",
      { app: "Firefox", connector: null },
    );
    expect(said).not.toContain("mark-1.png");
    expect(said).not.toContain(".png");
    expect(said).toContain("Debug:");
    expect(said).toContain("Tell me if this goes red.");
    expect(said).toContain("About: the build status");
    expect(said).toContain("In Firefox");
    expect(said).toContain("No pictures travel");
  });

  test("marks with nothing written on them add nothing to it", () => {
    const said = automationFor([{ tool: "box" }, { tool: "box" }], "ask", "Look here.", null);
    expect(said).not.toContain("About:");
    expect(said).toContain("Look here.");
  });
});

describe("folding the exact tools on the rail", () => {
  const sheet = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");

  test("the page and the stylesheet agree on how long it takes", () => {
    // The page re-measures the clickable region every frame while the rail is changing
    // size, and stops when it believes the motion has. Believe it too early and the
    // toolbar spends the rest of the animation answering the pointer where it used to
    // be — silent, and indistinguishable from a dead button. CSS cannot tell it the
    // number, so this checks the restatement against the source.
    const folding = /\.key\[data-folded="true"\][\s\S]*?transition:([\s\S]*?);/.exec(sheet)?.[1];
    assert.ok(folding, "the folded key's transition");
    expect(Math.max(...[...folding.matchAll(/(\d+)ms/g)].map((f) => Number(f[1])))).toBe(FOLD_TIME);
  });

  test("a folded key leaves the tab order exactly when it leaves the screen", () => {
    // Dropped at the start of the close it vanishes before it has finished closing;
    // never dropped at all, it stays focusable while invisible — a button somebody can
    // tab to and cannot see, which is the worse of the two.
    const closing = /\.key\[data-folded="true"\][\s\S]*?\}/.exec(sheet);
    assert.ok(closing, "the folded key's rules");
    expect(closing[0]).toContain("visibility: hidden");
    expect(closing[0]).toContain(`visibility 0s linear ${FOLD_TIME}ms`);

    const opening = /\.key\[data-folded="false"\][\s\S]*?\}/.exec(sheet);
    assert.ok(opening, "the unfolded key's rules");
    expect(opening[0]).toContain("visibility: visible");
    expect(opening[0]).not.toContain("visibility 0s linear");
  });

  test("the gap before a folded key is cancelled on whichever way the rail lies", () => {
    // Six keys of zero width still sit in six gaps. Without the negative margin they
    // leave a twenty-four pixel hole exactly where they used to be, which is the one
    // outcome folding was meant to avoid.
    expect(sheet).toContain('.rail-wrap[data-vertical="false"] .key[data-folded="true"]');
    expect(sheet).toContain('.rail-wrap[data-vertical="true"] .key[data-folded="true"]');
  });

  test("nothing about this lives in a menu", () => {
    // Folding is a thing the rail does to itself. A menu would be a second place to go
    // looking for a tool, which is worse than the long rail it was meant to fix.
    const page = readFileSync(new URL("../apps/linux/ui/toolbar.html", import.meta.url), "utf8");
    expect(page).not.toContain("fly-exact");
  });
});

describe("what the drawing tool draws with", () => {
  const across = { width: 1000, height: 1000 };
  const path = (kind: string, points: Point[]) => pathFor({ kind, points, screen: across });

  test("four pens, one key", () => {
    // They are all the same gesture and differ only in what is left behind, which is
    // not four keys' worth of difference on a rail this size.
    expect(Object.keys(PENS)).toEqual(["freehand", "arrow", "line", "highlight"]);
    expect(PENS[PEN_FIRST]).toBeDefined();
    expect(TOOLS.draw!.writes).toBe(false);
  });

  test("the tool's shape comes from the pen, not from the key", () => {
    expect(kindFor("draw", "arrow")).toBe("arrow");
    expect(kindFor("draw", "highlight")).toBe("highlight");
    // Every other tool answers for itself, and a pen it has never heard of is freehand
    // rather than nothing at all.
    expect(kindFor("box")).toBe("box");
    expect(kindFor("draw", "glitter")).toBe(PENS[PEN_FIRST]!.kind);
    expect(kindFor("draw", undefined)).toBe(PENS[PEN_FIRST]!.kind);
  });

  test("every pen draws a path, not an area", () => {
    // The difference decides whether the mark carries a region — and a region is what
    // the popup, the crop and the answer pin are all placed from.
    for (const pen of Object.values(PENS)) {
      expect(PATHS.includes(pen.kind), pen.label).toBe(true);
    }
  });

  test("an arrow is a shaft with a head on the end somebody stopped at", () => {
    const drawn = path("arrow", [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ]);
    // One path, so the outline drawn behind it in the picture follows the head as well
    // as the shaft — a head with its own floating outline is worse than none.
    expect(drawn.startsWith("M0.2 0.5L0.8 0.5")).toBe(true);
    // Both barbs come back to the tip, and neither sits past it.
    const barbs = [...drawn.matchAll(/L0\.8 0\.5/g)];
    expect(barbs.length).toBeGreaterThanOrEqual(1);
    for (const found of drawn.matchAll(/M?(0\.\d+) (0\.\d+)/g)) {
      expect(Number(found[1])).toBeLessThanOrEqual(0.8001);
    }
  });

  test("an arrow of no length is still a line rather than a head on its own tip", () => {
    // A press that went nowhere is thrown away before this, but a gesture caught
    // mid-frame has both points in the same place, and the head's maths divides by
    // the distance between them.
    const drawn = path("arrow", [
      { x: 0.4, y: 0.4 },
      { x: 0.4, y: 0.4 },
    ]);
    expect(drawn).toBe("M0.4 0.4L0.4 0.4");
    expect(drawn).not.toContain("NaN");
  });

  test("a line and a highlighter keep the two ends, not the wobble between them", () => {
    // Freehand keeps every point the hand passed through; a line somebody drew wobbling
    // is not a line they meant.
    const wobbled = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.6 },
    ];
    expect(path("line", wobbled)).toBe("M0.1 0.1 L0.5 0.6");
    expect(path("highlight", wobbled)).toBe("M0.1 0.1 L0.5 0.6");
  });

  test("the message names the pen, not the key", () => {
    // "Draw" says nothing about what was drawn. An arrow points at something and a
    // highlighter runs over it, and the agent reading this should be told which.
    expect(labelOf({ tool: "draw", pen: "arrow" })).toBe("Arrow");
    expect(labelOf({ tool: "draw", pen: "highlight" })).toBe("Highlighter");
    expect(labelOf({ tool: "draw" })).toBe("Freehand");
    const said = summaryFor([{ tool: "draw", pen: "arrow", note: "this one" }], "ask", "", null);
    expect(said).toContain("1. Arrow (mark-1.png) — this one");
  });

  test("every pen is on the menu under its own mark", () => {
    const rail = readFileSync(new URL("../apps/linux/ui/toolbar-rail.js", import.meta.url), "utf8");
    const drawn = new Set(
      [...rail.matchAll(/^ {2}(\w+):$|^ {2}(\w+):\s*'/gm)].map((found) => found[1] ?? found[2]),
    );
    for (const [id, pen] of Object.entries(PENS)) {
      expect(drawn.has(pen.glyph), `${id} wears ${pen.glyph}`).toBe(true);
    }
    const marks = Object.values(PENS).map((pen) => pen.glyph);
    expect(new Set(marks).size).toBe(marks.length);
  });
});

describe("the glass and the picture draw the same mark", () => {
  /*
   * The page draws a mark on screen and Rust draws it onto the photograph that is sent.
   * Two languages, one set of numbers — and what somebody sees on the glass is a
   * promise about what the agent will be looking at, so a preview drawn to different
   * numbers is a promise this toolbar quietly breaks. Read back out of the source that
   * does the second drawing rather than restated here.
   */
  const capture = readFileSync(
    new URL("../apps/linux/src-tauri/src/colai_capture.rs", import.meta.url),
    "utf8",
  );
  const number = (name: string) => {
    const found = new RegExp(`const ${name}: f64 = ([\\d.]+);`).exec(capture)?.[1];
    assert.ok(found, `${name} in colai_capture.rs`);
    return Number(found);
  };

  test("an arrowhead is the same head in both", () => {
    expect(number("ARROW_HEAD")).toBe(ARROW_HEAD);
    expect(number("ARROW_WIDE")).toBe(ARROW_WIDE);
    expect(number("ARROW_LEAST")).toBe(ARROW_LEAST);
    expect(number("ARROW_MOST")).toBe(ARROW_MOST);
  });

  test("a highlighter lays down the same width in both", () => {
    // The one where drifting is invisible until it matters: a stripe drawn thin on the
    // glass and thick in the picture covers words somebody thought they had left showing.
    expect(number("HIGHLIGHT_WIDE")).toBe(HIGHLIGHT_WIDE);
  });

  test("a head is bounded, so a long arrow does not grow one the size of a window", () => {
    const across = { width: 2000, height: 2000 };
    const far = pathFor({
      kind: "arrow",
      points: [
        { x: 0.05, y: 0.5 },
        { x: 0.95, y: 0.5 },
      ],
      screen: across,
    });
    // The barbs sit at most ARROW_MOST back along the line from the tip.
    const back = [...far.matchAll(/[ML](0\.\d+) /g)].map((found) => Number(found[1]));
    expect(Math.min(...back.filter((x) => x > 0.5))).toBeGreaterThanOrEqual(
      0.95 - ARROW_MOST / across.width - 0.001,
    );
  });
});

describe("nothing is reachable only by right click", () => {
  /*
   * The failure this guards is invisible by construction: a menu behind a key that
   * looks like every other key is a menu nobody finds. It happened twice — the design
   * family, then the pens — and both times the only symptom was somebody asking where
   * the feature had gone.
   *
   * So a right click may be a shortcut to a menu, never the only way in. Every flyout
   * a right click opens must also be opened by an ordinary press of something visible.
   */
  const page = ["toolbar-rail.js", "toolbar-compose.js", "toolbar.js"]
    .map((file) => readFileSync(new URL(`../apps/linux/ui/${file}`, import.meta.url), "utf8"))
    .join("\n");

  const RIGHT_CLICK = /addEventListener\("contextmenu"[\s\S]{0,400}?\}\);/g;
  /*
   * A menu that only *offers* things somebody can already reach hides nothing — it
   * saves a step, and the rule above is about capability rather than about every list
   * on the way to one. `how` is the send key's chooser: send this now, or put it on a
   * schedule. It is exempt from the rule above and answers to the second test instead.
   */
  const ACCELERATORS = new Set(["how"]);
  // Where those choices are built. Cut out of `shown` below, or an accelerator would
  // vouch for its own destinations and the second test would prove nothing.
  const offers = /howRow\([\s\S]{0,400}?\n {2}\}?\);/g;

  /*
   * Where a press goes. A flyout by name, or the Work window, which is opened by its own
   * function rather than through `flyout` — it is a window, not a menu, and does not
   * pretend to be one.
   */
  const opens = (source: string) => [
    ...[...source.matchAll(/flyout\("(\w+)"\)/g)].map((found) => found[1]!),
    ...[...source.matchAll(/\b(?:openWork|toggleWork)\b/g)].map(() => "work"),
  ];
  const hidden = new Set([...page.matchAll(RIGHT_CLICK)].flatMap((block) => opens(block[0])));
  const offered = [...page.matchAll(offers)].flatMap((block) => opens(block[0]));
  const shown = new Set(opens(page.replaceAll(RIGHT_CLICK, "").replaceAll(offers, "")));

  test("every menu a right click opens is opened by a visible control too", () => {
    expect(hidden.size).toBeGreaterThan(0);
    for (const menu of hidden) {
      if (ACCELERATORS.has(menu)) {
        continue;
      }
      expect(shown.has(menu), `${menu} is only reachable by right click`).toBe(true);
    }
  });

  test("an accelerator offers nothing that is not reachable without it", () => {
    // The send key's right click chooses between sending now and scheduling. Both
    // panels open from a plain press elsewhere — the composer from the key itself, the
    // schedule from a visible row inside the composer — so nobody who never right
    // clicks loses anything. The moment that stops being true this is a hiding place,
    // and the exemption above has to go rather than this assertion.
    expect(offered.length).toBeGreaterThan(1);
    for (const menu of offered) {
      expect(shown.has(menu), `${menu} is offered but not otherwise reachable`).toBe(true);
    }
  });

  test("there is one mark for a menu, and it is the caret", () => {
    // Box and circle, the kinds of design, the pens, the recording lengths and the
    // folded group all behave the same way: press the key, a list opens, pick from it.
    // A second idiom for the same idea is a second thing to learn for no gain.
    expect(page).toContain('const MENU = "caret"');
    expect(page).not.toContain("key-more");
  });
});

describe("what a window title says about where you are", () => {
  /*
   * The guessing layer, and the one that will be wrong in a way nobody notices. Titles
   * are a convention rather than an interface, so every rule matches a shape only one
   * kind of application produces — and the rows that must yield *nothing* are the point
   * of this table, not an afterthought.
   */
  const read = (title: string, app = "", exe = "") => placeOf({ title, app, exe });

  test("an editor gives up the file and the folder it is in", () => {
    expect(read("toolbar-rail.js — colai - Visual Studio Code")).toEqual({
      file: "toolbar-rail.js",
      project: "colai",
    });
    // Unsaved work wears a dot, which is not part of the filename.
    expect(read("● main.rs — openclaw - Visual Studio Code")).toEqual({
      file: "main.rs",
      project: "openclaw",
    });
    expect(read("notes.md (~/Documents) - Text Editor")).toEqual({
      file: "notes.md",
      project: "~/Documents",
    });
  });

  test("a browser gives up the page it is on, and never pretends to know the address", () => {
    // The URL is the layer above. A title that looked like one would be the worst
    // possible fact here: confidently wrong, and impossible to tell apart from a real
    // one further down the message.
    expect(read("Billing · Example — Mozilla Firefox")).toEqual({ page: "Billing · Example" });
    expect(read("Pull requests - Google Chrome")).toEqual({ page: "Pull requests" });
    expect(read("Docs — Mozilla Firefox").page).not.toContain("http");
  });

  test("a terminal gives up the path it is sitting in", () => {
    expect(read("someone@machine: ~/Desktop/colai")).toEqual({ path: "~/Desktop/colai" });
  });

  test("a title it does not recognise says nothing at all", () => {
    // Far more often the right answer than any guess. Every one of these contains a
    // separator some rule could have latched onto.
    expect(read("")).toEqual({});
    expect(read("Half Sword Demo")).toEqual({});
    expect(read("Slack | general | Example")).toEqual({});
    expect(read("Settings")).toEqual({});
    // A dash in a page's own title, in an application that is not a browser.
    expect(read("Getting started - a guide")).toEqual({});
  });

  test("the editor shape does not fire for something that merely resembles it", () => {
    // An em dash and a hyphen in one line is not enough; the application at the end has
    // to be one that writes its titles that way.
    expect(read("Chapter 3 — the middle - a novel")).toEqual({});
  });
});

describe("the address that travels with a mark", () => {
  const code: Front = {
    app: "Code",
    id: "0x1",
    title: "toolbar-rail.js — colai - Visual Studio Code",
    cwd: "/home/someone/Desktop/colai",
    at: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const browser: Front = {
    app: "Firefox",
    id: "0x2",
    title: "Billing · Example — Mozilla Firefox",
    url: "https://app.example.com/settings#billing",
    at: { x: 1920, y: 0, width: 1600, height: 900 },
  };

  test("the working directory leads, because it is the fact that cannot be wrong", () => {
    // Probed on a real desktop: a window whose class was `steam_app_2642680` sat in a
    // directory that named the application exactly. The title is a convention; this is
    // the kernel.
    const said = whereSaid(code).join("\n");
    expect(said).toContain("In Code — /home/someone/Desktop/colai");
    expect(said).toContain("window 1920×1080");
  });

  test("a fact read from a title says that it was", () => {
    // An agent must never be unable to tell something measured from something inferred.
    const said = whereSaid(code).join("\n");
    expect(said).toContain("file toolbar-rail.js in colai (read from the title)");
    expect(said).not.toContain("/home/someone/Desktop/colai (read from the title)");
  });

  test("a real URL replaces the page title rather than sitting beside it", () => {
    const said = whereSaid(browser).join("\n");
    expect(said).toContain("https://app.example.com/settings#billing");
    expect(said).not.toContain("(read from the title)");
  });

  test("a page with no address says the address was missing", () => {
    // An agent given a page title and no URL knows it has to go and find the page. One
    // given nothing assumes there was never a page to find. Measured on this desktop:
    // holding an accessibility connection open does not make browsers start answering,
    // so this is the common case and not the rare one.
    const said = whereSaid({ ...browser, url: undefined }).join("\n");
    expect(said).toContain('page "Billing · Example"');
    expect(said).toContain("the URL was not available");
  });

  test("no address is said as no address, not as nothing", () => {
    expect(whereSaid(null).join(" ")).toContain("would not say");
  });

  test("two windows are two addresses, however alike they look", () => {
    // The bug this exists for: one surface read at send time labelled every mark in a
    // batch with whichever window happened to be last.
    expect(samePlace(code, code)).toBe(true);
    expect(samePlace(code, browser)).toBe(false);
    expect(samePlace(code, { ...code, id: "0x9" })).toBe(false);
    expect(samePlace(browser, { ...browser, url: "https://app.example.com/other" })).toBe(false);
  });
});

describe("where a mark sits in the window it was made over", () => {
  const screen = { width: 3520, height: 1080 };
  const second: Front = {
    app: "Firefox",
    id: "0x2",
    at: { x: 1920, y: 0, width: 1600, height: 900 },
  };

  test("a region is given in the window's own pixels, not the desktop's", () => {
    // A desktop coordinate stops being true the moment somebody moves the window, and
    // means nothing to an agent that never saw the desk.
    const spot = spotIn({ region: { box: { x: 0.6, y: 0.1, w: 0.1, h: 0.1 } } }, second, screen);
    expect(spot).toEqual({ x: 0.6 * 3520 - 1920, y: 108, width: 352, height: 108 });
    expect(spotSaid(spot)).toBe("at 192,108 · 352×108");
  });

  test("a pin is a point and a stroke is a journey", () => {
    expect(spotSaid(spotIn({ points: [{ x: 0.6, y: 0.2 }] }, second, screen))).toBe("at 192,216");
    const drawn = spotIn(
      {
        points: [
          { x: 0.6, y: 0.2 },
          { x: 0.7, y: 0.4 },
        ],
      },
      second,
      screen,
    );
    expect(spotSaid(drawn)).toBe("192,216 → 544,432");
  });

  test("a mark made outside the window is not given coordinates inside it", () => {
    // The window with the keyboard is usually the one somebody is looking at, and
    // occasionally they reach across and mark something else. Offering a spot in a
    // window the mark is not in would be the confident kind of wrong this whole idea
    // exists to remove — and negative numbers are what it looks like when it happens.
    const across = spotIn(
      { region: { box: { x: 0.05, y: 0.1, w: 0.05, h: 0.05 } } },
      second,
      screen,
    );
    expect(across).toBeNull();
  });

  test("the message says when the address and the picture disagree", () => {
    // An agent that trusted the address over the picture would go and work on the wrong
    // thing, which costs more than having no address at all.
    const said = summaryFor([{ tool: "box", where: second, spot: null }], "ask", "", null);
    expect(said).toContain("marked outside that window");
    expect(said).toContain("Trust the picture");
  });

  test("no window means no coordinates rather than the desktop's", () => {
    // Half an answer here is worse than none: an agent given a number will use it.
    expect(spotIn({ points: [{ x: 0.5, y: 0.5 }] }, null, screen)).toBeNull();
    expect(spotIn({ points: [{ x: 0.5, y: 0.5 }] }, { app: "Code" }, screen)).toBeNull();
    expect(spotSaid(null)).toBeNull();
  });
});

describe("the message an agent actually reads", () => {
  const code: Front = {
    app: "Code",
    id: "0x1",
    title: "rail.js — colai - Visual Studio Code",
    cwd: "/home/someone/colai",
    at: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const browser: Front = { app: "Firefox", id: "0x2", url: "https://example.com/a" };

  test("marks made in one place share one address", () => {
    // Repeating it under every mark would spend more tokens than the whole idea saves.
    const said = summaryFor(
      [
        { tool: "box", where: code, spot: { x: 10, y: 20, width: 30, height: 40 } },
        { tool: "box", where: code, spot: { x: 50, y: 60, width: 70, height: 80 } },
      ],
      "ask",
      "",
      null,
    );
    expect(said.match(/In Code/g)).toHaveLength(1);
    expect(said).toContain("1. Box (mark-1.png) at 10,20 · 30×40");
    expect(said).toContain("2. Box (mark-2.png) at 50,60 · 70×80");
  });

  test("marks made in two places get two", () => {
    const said = summaryFor(
      [
        { tool: "box", where: code },
        { tool: "pointAt", where: browser },
      ],
      "ask",
      "",
      null,
    );
    expect(said).toContain("In Code");
    expect(said).toContain("In Firefox");
    expect(said).toContain("https://example.com/a");
  });

  test("a mark whose window could not be read still says what it is", () => {
    // Losing the address must never cost the picture and the note as well.
    const said = summaryFor([{ tool: "box", note: "this bit" }], "ask", "", null);
    expect(said).toContain("would not say");
    expect(said).toContain("1. Box (mark-1.png) — this bit");
  });

  test("an automation carries the address and refuses the coordinates", () => {
    // It runs later, when the window has moved or gone. "Which project" is still true
    // tomorrow; "340,128" is a number about a window that no longer exists.
    const said = automationFor(
      [{ tool: "box", where: code, spot: { x: 340, y: 128 } }],
      "ask",
      "watch this",
      null,
    );
    expect(said).toContain("In Code — /home/someone/colai");
    expect(said).not.toContain("340,128");
    expect(said).not.toContain("window 1920");
  });
});

describe("the page and the commands it calls", () => {
  /*
   * The two halves of this toolbar meet at a string. A Rust signature gains an argument,
   * a caller in the page does not, and nothing complains until somebody presses the
   * button — which is what happened: `files` became required on `colai_send`, the reply
   * on an answer pin never passed it, and pressing Accept produced "invalid args:
   * missing required key `files`" in front of somebody who was agreeing with a
   * suggestion.
   *
   * Neither language can see the other, so the check has to read both from source.
   */
  const dir = new URL("../apps/linux/", import.meta.url);
  const page = [
    "toolbar.js",
    "toolbar-rail.js",
    "toolbar-mark.js",
    "toolbar-live.js",
    "toolbar-answers.js",
    "toolbar-compose.js",
    "toolbar-library.js",
    "toolbar-send.js",
    "toolbar-dock.js",
  ]
    .map((file) => readFileSync(new URL(`ui/${file}`, dir), "utf8"))
    .join("\n");
  const rust = readdirSync(new URL("src-tauri/src/", dir))
    .filter((file) => file.endsWith(".rs"))
    .map((file) => readFileSync(new URL(`src-tauri/src/${file}`, dir), "utf8"))
    .join("\n");

  /** Every command the back end declares, and which of its arguments it insists on. */
  const commands = new Map<string, string[]>();
  for (const found of rust.matchAll(
    // A command that returns nothing has no `->`, and matching only on one made this
    // sweep run past it and swallow the command after it — which then read as missing.
    /#\[tauri::command\]\s*(?:pub\(crate\)\s*)?(?:async\s*)?fn (\w+)\(([\s\S]*?)\)\s*(?:->|\{)/g,
  )) {
    const required = found[2]!
      .replaceAll(/\/\/[^\n]*/g, "")
      .split(/,\s*(?![^<>()]*[>)])/)
      .map((one) => one.trim())
      .filter((one) => one.includes(":"))
      .map((one) => ({
        name: one.slice(0, one.indexOf(":")).trim(),
        type: one.slice(one.indexOf(":") + 1),
      }))
      // The runtime supplies these; nobody passes them from the page.
      .filter((one) => /^[a-z_]+$/.test(one.name) && !/State<|AppHandle/.test(one.type))
      .filter((one) => !/^\s*Option</.test(one.type))
      .map((one) => one.name.replaceAll(/_(\w)/g, (_, letter: string) => letter.toUpperCase()));
    commands.set(found[1]!, required);
  }

  /** Every call the page makes, and the keys it hands over. */
  const calls: { name: string; keys: string[] }[] = [];
  for (const found of page.matchAll(
    /invoke\(\s*"(\w+)"\s*(?:,\s*(\{[\s\S]*?\n\s*\}|\{[^{}]*\}))?/g,
  )) {
    // Both `name: value` and the shorthand `name`.
    const keys = found[2] ? [...found[2].matchAll(/[{,]\s*(\w+)\s*[:,}]/g)].map((k) => k[1]!) : [];
    calls.push({ name: found[1]!, keys });
  }

  test("the check itself found something to check", () => {
    // A regex that quietly matched nothing would pass every assertion below.
    expect(commands.size).toBeGreaterThan(10);
    expect(calls.length).toBeGreaterThan(10);
  });

  test("a command the page calls is registered, and allowed", () => {
    /*
     * Declaring a command is three edits, not one: the function, the handler list, and
     * the permission allow-list. Miss either of the last two and the function compiles,
     * the page compiles, and the button does nothing at all until somebody presses it.
     *
     * Only the ones the page actually calls: a command reachable from somewhere else is
     * not this test's business, and asserting on every one would make adding an
     * internal command a failure.
     */
    const main = readFileSync(new URL("src-tauri/src/main.rs", dir), "utf8");
    const handlers = main.slice(main.indexOf("generate_handler!"));
    const allowed = readFileSync(new URL("src-tauri/permissions/colai.toml", dir), "utf8");
    for (const call of new Set(calls.map((one) => one.name))) {
      // The last entry in the list carries no comma, so the boundary is the name's end.
      const listed = new RegExp(`::${call}\\b`).test(handlers);
      expect(listed, `${call} is not in the handler list`).toBe(true);
      expect(allowed.includes(`"${call}"`), `${call} is not allowed`).toBe(true);
    }
  });

  test("every command the page calls exists", () => {
    for (const call of calls) {
      expect(commands.has(call.name), `${call.name} is not a command`).toBe(true);
    }
  });

  test("every call hands over everything its command insists on", () => {
    for (const call of calls) {
      for (const key of commands.get(call.name) ?? []) {
        expect(call.keys, `${call.name} needs ${key}`).toContain(key);
      }
    }
  });
});

describe("knowing an agent is working", () => {
  const run = (key: string, heard: number): Run => ({ sessionKey: key, who: key, heard });

  test("a run that has just spoken is still working", () => {
    const now = 1_000_000;
    expect(stillRunning([run("a", now - 1000)], now)).toHaveLength(1);
  });

  test("a run that has gone quiet is one the toolbar has lost, not one still working", () => {
    // A glow that never goes out is worse than no glow: it is a claim about work that is
    // not happening. `session.ended` is the usual way it stops; this is the net beneath.
    const now = 1_000_000;
    expect(stillRunning([run("a", now - RUN_QUIET - 1)], now)).toHaveLength(0);
  });

  test("no agent working leaves no mood on the mascot at all", () => {
    /*
     * The bug this is about: the agent finishes and the icon keeps breathing green.
     *
     * The stylesheet pulses on `.home-key[data-mood]` — the attribute being *present* —
     * and the render cleared it by assigning "". An empty string is still an attribute,
     * so the selector went on matching and `minding` went on animating for ever over a
     * desktop where nothing was happening.
     */
    expect(moodMark(null)).toBe(null);
    expect(moodMark({ running: 0, waiting: 0, trouble: 0 })).toBe(null);
    // And it still says the mood when there is one to say.
    expect(moodMark({ running: 2, waiting: 0, trouble: 0 })).toBe("working");
    expect(moodMark({ running: 1, waiting: 1, trouble: 0 })).toBe("waiting");
    expect(moodMark({ running: 1, waiting: 1, trouble: 1 })).toBe("trouble");
  });

  test("the mascot's mood is removed, not emptied, because the stylesheet keys on it being there", () => {
    // A pure helper cannot catch this on its own: the defect was the assignment, and it
    // is only wrong because of what the stylesheet does with a bare attribute. So the
    // two files are asserted against each other.
    const style = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");
    const render = readFileSync(new URL("../apps/linux/ui/toolbar.js", import.meta.url), "utf8");
    // The stylesheet does key an animation off the attribute simply being present.
    expect(style).toMatch(/\.home-key\[data-mood\]\s*\{[^}]*animation:/);
    // So the render must delete it rather than assign a falsy value to it.
    expect(render).toMatch(/delete\s+buttons\.settings\.dataset\.mood/);
    expect(render).not.toMatch(/dataset\.mood\s*=\s*["'`]["'`]/);
    expect(render).not.toMatch(/dataset\.mood\s*=\s*\w+\s*\?[^;]*:\s*["'`]["'`]/);
  });

  test("when the Gateway says nothing is running, nothing is running", () => {
    /*
     * The bug this is about: an agent finishes, and the stop key stays over a run there
     * is nothing left to stop while the crab keeps walking green. Every ingredient of
     * `stillRunning` is still true — this toolbar started it, was never told it ended,
     * and it spoke a moment ago — because all three are inferences, and the terminal
     * frame that would have settled it never arrived.
     *
     * The Gateway knows, and is already asked every few seconds for the light.
     */
    const now = 1_000_000;
    const just = [run("a", now - 1000)];
    expect(stillRunning(just, now)).toHaveLength(1);
    expect(runsNow(just, { running: 0, waiting: 0, trouble: 0 }, now)).toHaveLength(0);
  });

  test("somebody else's agent working is not this one still working", () => {
    // Only zero is taken as the answer. The light counts every agent on the Gateway, so
    // a busy count says nothing about this run — and clearing on it would put the stop
    // key out while work was genuinely underway.
    const now = 1_000_000;
    const just = [run("a", now - 1000)];
    expect(runsNow(just, { running: 3, waiting: 0, trouble: 0 }, now)).toHaveLength(1);
    // Busy, but this one has gone quiet: the net underneath still catches it.
    expect(
      runsNow([run("a", now - RUN_QUIET - 1)], { running: 3, waiting: 0, trouble: 0 }, now),
    ).toHaveLength(0);
  });

  test("a Gateway that has not answered yet decides nothing", () => {
    // Null is "not asked", not "nothing running". Treating it as zero would put the
    // light out for the first seconds after launch, every launch.
    const now = 1_000_000;
    expect(runsNow([run("a", now - 1000)], null, now)).toHaveLength(1);
  });

  test("the net is slack enough not to give up on a thinking agent", () => {
    // An agent genuinely says nothing for minutes. Timing out on one is the same lie in
    // the other direction — the rail would go dark on work that is happening.
    expect(RUN_QUIET).toBeGreaterThanOrEqual(2 * 60 * 1000);
  });

  test("one working and four working are different things to be told", () => {
    expect(runningSaid([])).toBeNull();
    expect(runningSaid(undefined)).toBeNull();
    expect(runningSaid([run("a", 0)])).toBe("working");
    expect(runningSaid([run("a", 0), run("b", 0), run("c", 0)])).toBe("3 working");
  });
});

describe("which marks arrive as one picture", () => {
  test("a recording does, because eight pictures of a screen is a bill", () => {
    expect(sheeted({ tool: "record", frames: 8 })).toBe(true);
  });

  test("a single picture is already one picture", () => {
    expect(sheeted({ tool: "record", frames: 1 })).toBe(false);
    expect(sheeted({ tool: "box", frames: 1 })).toBe(false);
  });
});

describe("when an agent is asking rather than telling", () => {
  test("a turn that ends in a question is one", () => {
    expect(asksSomething("Two ways to do it. Which would you rather?")).toBe(true);
    expect(asksSomething("Should I write it to docs/Design/ or somewhere else?")).toBe(true);
  });

  test("the forms that ask without the mark are caught", () => {
    expect(asksSomething("Let me know which of those you want")).toBe(true);
    expect(asksSomething("Tell me whether the second one is closer")).toBe(true);
  });

  test("a question that answers itself is not waiting on anybody", () => {
    // Agents ask rhetorically and then carry on. A pin that cried wolf on every reply
    // is a pin somebody stops reading, which costs more than never having had one.
    expect(asksSomething("Why is the gap there? Because the margin collapses.")).toBe(false);
    expect(
      asksSomething("Which file? toolbar-rail.js.\nI have changed it and the tests pass."),
    ).toBe(false);
  });

  test("a plain report is not a question", () => {
    expect(asksSomething("Fixed. The margin is on the section now and the tests pass.")).toBe(
      false,
    );
    expect(asksSomething("")).toBe(false);
    expect(asksSomething("   ")).toBe(false);
  });

  test("a sentence merely containing one of the forms is not asking", () => {
    // Anchored to the start of the last line, so prose about a decision is not mistaken
    // for a request to make one.
    expect(asksSomething("I could not tell which of them you meant so I did neither.")).toBe(false);
  });
});

describe("taking a conversation back", () => {
  const admin = ["operator.read", "operator.admin"];

  test("a Gateway session can be gone back through", () => {
    expect(canGoBack({ kind: "session", id: "s1", sessionKey: "s1" }, admin).can).toBe(true);
  });

  test("a thread cannot, until it has been sent to once", () => {
    const cold = canGoBack({ kind: "thread", id: "t1" }, admin);
    expect(cold.can).toBe(false);
    expect(cold.why).toContain("Send to this conversation once");
    expect(canGoBack({ kind: "thread", id: "t1", sessionKey: "s9" }, admin).can).toBe(true);
  });

  test("a conversation the Gateway has refused is not offered again", () => {
    /*
     * Whether a conversation's history is owned by the agent that started it is not
     * something this side can see — on this machine the two that are arrive in the list
     * as ordinary sessions. Guessing from the shape of a row got it exactly backwards:
     * it refused conversations that rewind fine and offered the two that cannot.
     *
     * So it is asked by trying, once, and the answer is kept.
     */
    const row = { kind: "session", id: "held", sessionKey: "held" };
    expect(canGoBack(row, admin).can).toBe(true);
    rewindRefused(
      new Error(
        "Session history changes are unavailable because this session is owned by an external agent harness.",
      ),
      "held",
    );
    const now = canGoBack(row, admin);
    expect(now.can).toBe(false);
    expect(now.why).toContain("rewind it there");
    // And only that one: nothing else is tarred with it.
    expect(canGoBack({ kind: "session", id: "other", sessionKey: "other" }, admin).can).toBe(true);
  });

  test("older refusals still read plainly", () => {
    // What it actually says is true and addressed to nobody. The toolbar knows what it
    // means and can say the useful half.
    const refused = rewindRefused(
      new Error(
        "Session history changes are unavailable because this session is owned by an external agent harness.",
      ),
    );
    expect(refused).toContain("rewind it there");
    expect(refused).not.toContain("harness");

    expect(rewindRefused(new Error("Rewind is unavailable for archived sessions."))).toContain(
      "archived",
    );
    // Anything it has not been taught is passed through rather than swallowed: a
    // refusal nobody can read still beats one nobody can see.
    expect(rewindRefused(new Error("the disk is on fire"))).toContain("the disk is on fire");
    expect(rewindRefused(null)).toContain("did not say why");
  });

  test("an agent is not a conversation", () => {
    expect(canGoBack({ kind: "agent", id: "main" }, admin).can).toBe(false);
  });

  test("without the scope it is not offered, and says why", () => {
    // Read off the handshake rather than assumed. A button that always fails is worse
    // than one that is not there.
    const no = canGoBack({ kind: "session", id: "s1", sessionKey: "s1" }, ["operator.read"]);
    expect(no.can).toBe(false);
    expect(no.why).toContain("not allowed");
  });

  test("not having heard yet is not a refusal", () => {
    // The Gateway connects a moment after the app does, so the first ask lands before
    // there is anything to answer it. Reading that silence as "no" turned a moment of
    // waiting into a permanent-sounding refusal that never corrected itself — which is
    // exactly what shipped.
    const row = { kind: "session", id: "s1", sessionKey: "s1" };
    for (const nothing of [[], undefined]) {
      const yet = canGoBack(row, nothing);
      expect(yet.can).toBe(false);
      expect(yet.why).toContain("Still asking");
      expect(yet.why).not.toContain("not allowed");
    }
  });

  test("the panel says what it does not do, before anything is chosen", () => {
    // The one sentence that has to be there. Somebody who believes their work reverted
    // and finds out later is the worst outcome this surface could produce, so it is
    // stated where they read it rather than left to be discovered.
    expect(REWIND_SAYS).toContain("files are not touched");
    expect(REWIND_SAYS).toContain("only the conversation");
  });

  test("a prompt is its words and a time, kept apart", () => {
    // They compete for the same room and the wrong one loses. The words are what
    // somebody remembers; the time is what tells two similar messages apart.
    const now = 1_000_000_000_000;
    expect(pointSaid({ said: "fix  the header\n gap", at: now - 600_000 }, now)).toEqual({
      words: "fix the header gap",
      when: "10 minutes ago",
    });
    expect(pointSaid({ said: "no clock on this one", at: null }, now).when).toBeNull();
  });

  test("a message with no words is still a place, and says what it is", () => {
    // An attachment-only message has a place in the transcript. Being unable to
    // summarise it is no reason to make it unreachable or to show an empty row.
    expect(pointSaid({ said: "", at: null }, 0).words).toContain("attachment");
  });

  test("how long ago is read in whichever unit the Gateway sent", () => {
    const now = 1_000_000_000_000;
    // Milliseconds, and the same instant in seconds, must not be four decades apart.
    expect(agoSaid(now - 600_000, now)).toBe("10 minutes ago");
    expect(agoSaid((now - 600_000) / 1000, now)).toBe("10 minutes ago");
    expect(agoSaid(now - 30_000, now)).toBe("just now");
    expect(agoSaid(now - 7_200_000, now)).toBe("2 hours ago");
    // One of anything is one of it, not one of them.
    expect(agoSaid(now - 3_600_000, now)).toBe("1 hour ago");
    expect(agoSaid(now - 100_000, now)).toBe("2 minutes ago");
    expect(agoSaid(now - 86_400_000, now)).toBe("1 day ago");
  });
});

describe("a mark belongs to what it was marked on", () => {
  /*
   * The bug this is about: point at something in a tab, switch tab, and the dot is still
   * there — same pixels, different content. A mark is a place in an application, not a
   * place on the desktop.
   */
  const SCREEN = { width: 3840, height: 1080 };
  // A window on the right-hand monitor, well away from the origin so an anchor that
  // quietly forgot to subtract it would be obviously wrong rather than nearly right.
  const WINDOW = { x: 2000, y: 100, width: 800, height: 600 };
  const A_MARK = { x: 2400 / 3840, y: 400 / 1080, w: 200 / 3840, h: 150 / 1080 };

  test("a place on the screen becomes a place inside the window", () => {
    const inside = intoWindow(A_MARK, WINDOW, SCREEN);
    // 400px along a 800px window, 300px down a 600px one.
    expect(inside.x).toBeCloseTo(0.5, 6);
    expect(inside.y).toBeCloseTo(0.5, 6);
    expect(inside.w).toBeCloseTo(0.25, 6);
    expect(inside.h).toBeCloseTo(0.25, 6);
  });

  test("and comes back to the same place while the window has not moved", () => {
    const there = ontoScreen(intoWindow(A_MARK, WINDOW, SCREEN), WINDOW, SCREEN);
    for (const edge of ["x", "y", "w", "h"] as const) {
      expect(there[edge]!, edge).toBeCloseTo(A_MARK[edge], 9);
    }
  });

  test("a window that moved takes its marks with it", () => {
    const inside = intoWindow(A_MARK, WINDOW, SCREEN);
    const moved = { ...WINDOW, x: WINDOW.x - 300, y: WINDOW.y + 40 };
    const there = ontoScreen(inside, moved, SCREEN);
    expect(there.x * SCREEN.width).toBeCloseTo(2400 - 300, 6);
    expect(there.y * SCREEN.height).toBeCloseTo(400 + 40, 6);
    // The same size: moving a window does not stretch what is on it.
    expect(there.w! * SCREEN.width).toBeCloseTo(200, 6);
  });

  test("a window that was resized scales them", () => {
    const inside = intoWindow(A_MARK, WINDOW, SCREEN);
    const half = { ...WINDOW, width: 400, height: 300 };
    const there = ontoScreen(inside, half, SCREEN);
    // Still halfway across, and half the size it was.
    expect(there.x * SCREEN.width).toBeCloseTo(2000 + 200, 6);
    expect(there.w! * SCREEN.width).toBeCloseTo(100, 6);
  });

  test("a point has no size and does not grow one", () => {
    const pin = { x: 0.5, y: 0.5 };
    const inside = intoWindow(pin, WINDOW, SCREEN);
    expect(inside.w).toBeUndefined();
    expect(ontoScreen(inside, WINDOW, SCREEN).h).toBeUndefined();
  });

  test("every tool follows its window except the two about the display itself", () => {
    // Asserted against the whole table rather than as a list, so a tool added later is a
    // deliberate answer instead of an omission.
    expect([...FOLLOWS_WINDOW].toSorted()).toEqual(
      Object.keys(TOOLS)
        .filter((tool) => !["pointer", "screenshot", "record", "surfaceWrite"].includes(tool))
        .toSorted(),
    );
    expect(FOLLOWS_WINDOW).not.toContain("screenshot");
    expect(FOLLOWS_WINDOW).not.toContain("record");
  });

  test("an anchor needs a window with a size, or there is no anchor", () => {
    const front = { app: "Chrome", title: "colai", id: "0x1", at: WINDOW } as unknown as Front;
    expect(anchorOf(front)).toEqual({ id: "0x1", at: WINDOW, title: "colai", url: null });
    expect(anchorOf(null)).toBeNull();
    expect(anchorOf({ ...front, at: null } as unknown as Front)).toBeNull();
    // A window reported with no width describes no rectangle, and half a rectangle would
    // put a mark somewhere nobody put it.
    expect(anchorOf({ ...front, at: { ...WINDOW, width: 0 } } as unknown as Front)).toBeNull();
  });

  describe("and is drawn where its window is now", () => {
    const inside = intoWindow(A_MARK, WINDOW, SCREEN);
    const held = {
      tool: "box",
      on: { id: "0x1", at: WINDOW, title: "Prices", url: null },
      inside: { box: inside, points: [] },
      region: { box: A_MARK },
    };

    test("a window that moved carries its marks", () => {
      const moved = { ...WINDOW, x: WINDOW.x - 300 };
      const drawn = asDrawn(held, { id: "0x1", at: moved }, SCREEN);
      expect(drawn.region!.box.x * SCREEN.width).toBeCloseTo(2400 - 300, 6);
      // And the mark itself is untouched: `region.box` is where this was when it was
      // marked, the picture was cropped from it, and the message describes it.
      expect(held.region.box.x).toBeCloseTo(A_MARK.x, 9);
    });

    test("a mark with nothing to go on is given back exactly as it was", () => {
      // Older marks, marks made when the desktop could not say which window it was, and
      // every moment before the watcher has spoken.
      expect(asDrawn(held, null, SCREEN)).toBe(held);
      expect(
        asDrawn({ tool: "box", region: { box: A_MARK } }, { id: "0x1", at: WINDOW }, SCREEN),
      ).toEqual({ tool: "box", region: { box: A_MARK } });
      // A different window in front moves nothing — that mark is not drawn at all.
      expect(asDrawn(held, { id: "0x2", at: WINDOW }, SCREEN)).toBe(held);
    });
  });

  describe("and is drawn only while that is what you are looking at", () => {
    const ON = { id: "0x1", at: WINDOW, title: "Prices — Shop", url: null };
    const pin = { tool: "pointAt", on: ON };

    test("the window it was made on, and not another", () => {
      expect(showingNow(pin, { id: "0x1", title: "Prices — Shop" })).toBe(true);
      expect(showingNow(pin, { id: "0x2", title: "Something else" })).toBe(false);
    });

    test("the toolbar's own window is never something else", () => {
      /*
       * The one that makes this usable rather than maddening. Opening a popup makes the
       * overlay the active window, so a rule that only asked "is your window in front"
       * would erase every mark the instant anybody reached for the toolbar — including
       * the mark whose popup they just opened.
       */
      expect(showingNow(pin, { ours: true })).toBe(true);
      expect(showingNow(pin, { ours: true, id: "colai" })).toBe(true);
    });

    test("a tab change hides it, by url where there is one and by title otherwise", () => {
      // One browser window keeps one id across every tab, so the id alone cannot see the
      // change that half of this is about.
      expect(showingNow(pin, { id: "0x1", title: "Basket — Shop" })).toBe(false);
      const withUrl = { tool: "pointAt", on: { ...ON, url: "https://shop/prices" } };
      expect(showingNow(withUrl, { id: "0x1", url: "https://shop/prices" })).toBe(true);
      expect(showingNow(withUrl, { id: "0x1", url: "https://shop/basket" })).toBe(false);
      // A url on the mark and none to compare with falls back to the title.
      expect(showingNow(withUrl, { id: "0x1", title: "Prices — Shop" })).toBe(true);
    });

    test("nothing in front takes them off the screen", () => {
      /*
       * Minimise the window you marked and X reports no active window at all. Read as
       * "cannot tell" that put every mark back on the bare desktop, which is exactly
       * what it looks like when the tracking has failed — and was the report.
       *
       * So the watcher says it as a window with no id, which is an answer, and an answer
       * means hide.
       */
      expect(showingNow(pin, { id: "" })).toBe(false);
      expect(showingNow(pin, {})).toBe(false);
    });

    test("what has not been heard yet is left alone rather than taken away", () => {
      // The moment before the watcher has spoken, and marks made when the desktop could
      // not say which window they were on. Hiding somebody's mark for want of
      // information is worse than the thing this fixes — but it has to be told apart
      // from being told there is nothing in front, which is the distinction above.
      expect(showingNow(pin, null)).toBe(true);
      expect(showingNow({ tool: "pointAt" }, { id: "0x9" })).toBe(true);
    });

    test("a screenshot is about the display, so nothing hides it", () => {
      expect(showingNow({ tool: "screenshot", on: ON }, { id: "0x9" })).toBe(true);
      expect(showingNow({ tool: "record", on: ON }, { id: "0x9" })).toBe(true);
    });
  });
});

describe("the tray entry for the toolbar", () => {
  const src = new URL("../apps/linux/src-tauri/src/", import.meta.url);
  const tray = readFileSync(new URL("tray.rs", src), "utf8");
  const colai = readFileSync(new URL("colai.rs", src), "utf8");

  test("it is named for the thing, not for one of its tools", () => {
    // It said "Point at something", which described the first tool on the rail. By now
    // that is one of nine, and the entry is how somebody finds the toolbar itself.
    expect(tray).toContain('"Toolbar"');
    expect(tray).not.toContain('"Point at something"');
  });

  test("it puts the toolbar away as well as fetching it", () => {
    // The toolbar can be dismissed from its own keyboard, so an entry that could only
    // turn it on left somebody hunting for a way back through a menu that said nothing
    // about it.
    const pressed = tray.slice(tray.indexOf("COLAI_ID => {"));
    expect(pressed.slice(0, 200)).toContain("toggle_toolbar");
  });

  test("and both ways of moving it tell the tray, so the tick cannot lie", () => {
    /*
     * The tick is only worth having if it is true. Showing and hiding are the only two
     * things that move the toolbar, and Escape reaches the second one without the menu
     * being involved — so a tray that learned only from its own clicks would be
     * confidently wrong the first time anybody pressed it.
     */
    const inside = (fn: string) => {
      const from = colai.indexOf(`fn ${fn}(`);
      expect(from, fn).toBeGreaterThan(-1);
      return colai.slice(from, colai.indexOf("\n}\n", from));
    };
    expect(inside("colai_summon")).toContain("tray_says_toolbar(&app, true)");
    expect(inside("colai_release")).toContain("tray_says_toolbar(&app, false)");
  });
});

describe("the crab walks in one place, by one rule", () => {
  const css = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");

  test("nothing on the desktop waits with a crab any more", () => {
    /*
     * The pin was the second place a crab walked, and briefly the nicer one. Then every
     * mark moved into the Work window and a circle left on somebody's screen became the
     * thing being complained about rather than the exception to it.
     *
     * The gait stayed general, because it cost nothing to leave it that way and the
     * mascot is drawn in more than one size regardless.
     */
    const answers = readFileSync(
      new URL("../apps/linux/ui/toolbar-answers.js", import.meta.url),
      "utf8",
    );
    expect(answers).not.toContain("answer-dot");
    expect(answers).not.toContain("openclawMark");
  });

  test("one trigger drives the gait wherever it is drawn", () => {
    // Tying it to the tray key's own state meant a second place would have to restate
    // the whole walk, and two copies of a walk drift apart.
    for (const part of ["crab-body", "crab-leg-a", "crab-claw-b"]) {
      const rule = new RegExp(`([^\\n{]*)\\.${part}\\s*\\{`, "g");
      for (const found of css.matchAll(rule)) {
        const selector = found[1]!.trim();
        expect(
          selector === "" || selector.startsWith("[data-walking"),
          `${part} is driven by ${selector || "(bare)"}`,
        ).toBe(true);
      }
    }
  });
});

describe("the work leaves the screen", () => {
  const ON = {
    id: "0x1",
    at: { x: 0, y: 0, width: 800, height: 600 },
    title: "Prices",
    url: null,
  };
  const pin = { tool: "pointAt", on: ON };
  const front = { id: "0x1", title: "Prices" };

  test("marks are drawn while a tool is out, and not once it is away", () => {
    /*
     * The whole complaint. Making four marks needs them visible; everything after that
     * does not, and a screen carrying yesterday's annotations is a screen somebody works
     * around rather than one they work on.
     */
    expect(showingNow(pin, front, { tool: "pointAt", showing: false })).toBe(true);
    expect(showingNow(pin, front, { tool: "pointer", showing: false })).toBe(false);
  });

  test("and always when the Work window has been asked to show them", () => {
    // The way to look at what is waiting without picking a tool up.
    expect(showingNow(pin, front, { tool: "pointer", showing: true })).toBe(true);
  });

  test("a screenshot is not a mark on somebody's screen and is unaffected", () => {
    expect(showingNow({ tool: "screenshot", on: ON }, front, { tool: "pointer" })).toBe(true);
  });

  test("nothing asked means nothing changed", () => {
    // Every caller passes it; a caller that did not would get what it got before rather
    // than an empty screen it never asked for.
    expect(showingNow(pin, front)).toBe(true);
  });

  test("a sent piece of work is called by its words, or by what went", () => {
    expect(entrySaid({ said: "  the gap under the  header ", shots: [null] })).toBe(
      "the gap under the header",
    );
    // A send with no note is a send whose whole content is the pictures, and that is
    // what it is called — not an empty line somebody has to hover to identify.
    expect(entrySaid({ said: "", shots: [null, null] })).toBe("2 marks");
    expect(entrySaid({ shots: [null] })).toBe("1 mark");
    expect(entrySaid({})).toContain("nothing marked");
  });
});

describe("where the work is assembled", () => {
  const dir = new URL("../apps/linux/ui/", import.meta.url);
  const rail = readFileSync(new URL("toolbar-rail.js", dir), "utf8");
  const send = readFileSync(new URL("toolbar-send.js", dir), "utf8");
  const compose = readFileSync(new URL("toolbar-compose.js", dir), "utf8");

  test("one place, not two", () => {
    // The composer had a flyout of its own and the window has a section for it. Both
    // would be two places to assemble the same send, which is the thing this replaces.
    expect(rail).toContain('send.addEventListener("click", toggleWork)');
    expect(compose).toContain("function drawComposer(into)");
    expect(compose).not.toContain("el.flySend");
  });

  test("what was sent is kept before what was sent is cleared", () => {
    /*
     * The marks and the words are cleared the moment a send lands. An entry assembled
     * after that is an entry about pictures nobody can see and words nobody typed, so
     * both are held before anything is dispatched.
     */
    const held = send.indexOf("const said = state.text");
    const dispatched = send.indexOf('await invoke("colai_send"');
    const cleared = send.indexOf('state.text = ""');
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(dispatched);
    expect(held).toBeLessThan(cleared);
  });

  test("the answer the pin holds is the answer the history holds", () => {
    // One object, so a reply landing on the pin lands in the list too. Two copies would
    // be two truths about the same conversation.
    expect(send).toContain("if (answer) state.answers.push(answer)");
    expect(send).toMatch(/state\.history = \[\s*\{[\s\S]*?answer,/);
  });
});

describe("an answer says that it arrived", () => {
  const page = readFileSync(new URL("../apps/linux/ui/toolbar.js", import.meta.url), "utf8");
  const toast = readFileSync(new URL("../apps/linux/ui/toolbar-toast.js", import.meta.url), "utf8");

  test("once per answer, not once per turn", () => {
    /*
     * An agent says what it is doing before it says what it found, so one send that
     * talks four times is one thing that happened. Four toasts for it would be the
     * toolbar shouting about its own progress.
     */
    const heard = page.slice(page.indexOf('listen("colai:reply"'));
    expect(heard).toContain("const spoken = turns.some((turn) => !turn.mine)");
    expect(heard).toMatch(/if \(!spoken\) raiseToast\(/);
  });

  test("it leaves on its own, and takes its timer with it", () => {
    // A notification that has to be dismissed is a second thing to do. And a timer left
    // running for a toast somebody already pressed fires into an empty list.
    expect(toast).toMatch(/setTimeout\(\(\) => dropToast\(id\), TOAST_FOR\)/);
    expect(toast).toContain("clearTimeout(timer)");
    expect(toast).toContain("fading.delete(id)");
  });

  test("pressing it opens the answer where it was asked", () => {
    // The pin is how a reply is read in the place it is about; the toast is only how you
    // find out there is one.
    expect(toast).toContain("answer.open = true");
  });
});

describe("a mark goes somewhere rather than vanishing", () => {
  const dir = new URL("../apps/linux/ui/", import.meta.url);
  const work = readFileSync(new URL("toolbar-work.js", dir), "utf8");
  const rail = readFileSync(new URL("toolbar-rail.js", dir), "utf8");
  const page = readFileSync(new URL("toolbar.js", dir), "utf8");

  test("it flies on the way out and not on the way back in", () => {
    // Picking a tool up puts the marks back on the screen. A flight then would be
    // describing the opposite of what just happened.
    const use = rail.slice(rail.indexOf("function use(tool)"));
    expect(use).toContain('tool === "pointer" && state.tool !== "pointer"');
    expect(use.slice(0, 400)).toContain("flyToWork(state.marks)");
  });

  test("a desktop that asked for stillness is not told in motion", () => {
    // The marks are in the window either way, and the window is one press away.
    const fly = work.slice(work.indexOf("function flyToWork"));
    // Before anything is built: a guard after the work is a guard that did the work.
    expect(fly.indexOf("if (still()")).toBeLessThan(fly.indexOf("createElement"));
  });

  test("it is painted, not caught", () => {
    /*
     * Inert, and gone a third of a second later. Putting it in the clickable region
     * would claim a strip of somebody's desktop for the length of an animation — the
     * exact failure the recording frame already avoids.
     */
    const shape = page.slice(page.indexOf("function shape()"));
    expect(shape).not.toContain("el.flights");
    const css = readFileSync(new URL("toolbar.css", dir), "utf8");
    expect(css).toMatch(/\.flights \{[^}]*pointer-events: none/);
  });
});

describe("nothing the toolbar says about itself outstays it", () => {
  const dir = new URL("../apps/linux/ui/", import.meta.url);
  const page = readFileSync(new URL("toolbar.js", dir), "utf8");
  const toast = readFileSync(new URL("toolbar-toast.js", dir), "utf8");

  test("five seconds, and one number saying so", () => {
    expect(toast).toContain("const TOAST_FOR = 5000");
    // The banner by the rail uses the same clock. Two numbers for "how long something
    // the toolbar said stays up" would drift, and there is no reason for them to differ.
    expect(page).toContain("}, TOAST_FOR)");
  });

  test("the banner takes itself away", () => {
    /*
     * It had no way out at all. "Stopped main." was set, drawn, and then sat beside the
     * toolbar for the rest of the session — every message there is about a moment, and
     * none of them said so. A banner that outlives what it is about stops being read.
     */
    const drawn = page.slice(page.indexOf("function drawTrouble()"));
    expect(drawn).toContain("state.trouble = null");
  });

  test("its clock runs from the words, not from the frame", () => {
    // `drawTrouble` runs on every render. Restarting the timer each time would mean it
    // never ran out, which is the bug with extra steps.
    const drawn = page.slice(page.indexOf("function drawTrouble()"));
    const guard = drawn.indexOf("if (said === saidLast) return");
    const scheduled = drawn.indexOf("setTimeout");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(scheduled);
  });
});

describe("the Work window can be moved", () => {
  const work = readFileSync(new URL("../apps/linux/ui/toolbar-work.js", import.meta.url), "utf8");

  test("picked up by the bar with its name on it", () => {
    // Where every other window on this desktop is picked up from. A window meant to stay
    // open all day that cannot be moved is a window in the way for the whole day.
    expect(work).toContain('head.addEventListener("pointerdown", startWorkDrag)');
    // Not by its close button, which is on that bar and means the opposite.
    expect(work).toContain('event.target.closest(".popup-shut")');
  });

  test("held inside the screen it is being carried over", () => {
    // The desktop spans several. A window dragged off the edge of one has to stop at the
    // edge of *that* one, not at the edge of all of them.
    const drag = work.slice(work.indexOf("function startWorkDrag"));
    expect(drag.slice(0, 900)).toContain("usable(screenAt(state.screens,");
  });

  test("and stays where it was put", () => {
    expect(work).toMatch(/const up = \(\) => \{[\s\S]*?remember\(\);/);
    expect(work).toContain("state.work.at ||");
  });
});

describe("hidden means hidden", () => {
  const css = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");

  test("one rule outranks every display in the file", () => {
    /*
     * The browser's own `[hidden] { display: none }` is the weakest rule there is: any
     * `display` here beats it, and `all: unset` discards it. Three elements have been
     * caught drawn while the page believed them hidden — two rail keys, then the library
     * window, which set `display: flex` and so sat in the corner of somebody's screen as
     * an empty dark box, permanently, looking like a bug in something else entirely.
     */
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  test("and it is stated once, not remembered per element", () => {
    // A per-element workaround is a rule somebody has to know about before writing the
    // element that needs it, which is exactly the order this keeps being found in.
    // Comments in this file quote the rule they are about, so they are taken out first.
    const rules = [
      ...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/[^\n{]*\[hidden\][^\n{]*\{/g),
    ];
    expect(rules.length).toBe(1);
    expect(rules[0]![0].trim().startsWith("[hidden]")).toBe(true);
  });
});

describe("a window lands on a screen, not across two", () => {
  /*
   * The desktop this was found on: two 1920x1080 monitors side by side, the right one
   * carrying the dock. The overlay spans both, so a window centred on the *viewport* is
   * centred on the union — which is the bezel. The library window opened there, split
   * down the middle, with its close button on the screen nobody was looking at, and the
   * only other way out was a key nobody had been told about.
   */
  const NOTHING = { left: 0, top: 0, right: 0, bottom: 0 };
  const LEFT = { x: 0, y: 0, width: 1920, height: 1080, reserved: NOTHING };
  const RIGHT = {
    x: 1920,
    y: 0,
    width: 1920,
    height: 1080,
    reserved: { left: 66, top: 32, right: 0, bottom: 32 },
  };
  const SCREENS = [LEFT, RIGHT];
  const WINDOW = { width: 560, height: 420 };

  const put = (at: { x: number; y: number }) =>
    // Never null here: the list is never empty, and screenAt falls back to the nearest.
    centredIn(usable(screenAt(SCREENS, at)!), WINDOW);

  test("it opens on the screen the mark is on", () => {
    const onLeft = put({ x: 400, y: 300 });
    expect(onLeft.x).toBe(680);
    expect(onLeft.x + WINDOW.width).toBeLessThanOrEqual(1920);

    const onRight = put({ x: 2800, y: 300 });
    expect(onRight.x).toBeGreaterThanOrEqual(1920);
    expect(onRight.x + WINDOW.width).toBeLessThanOrEqual(3840);
  });

  test("it never straddles the seam between them", () => {
    // The assertion that would have caught this: wherever it opens, it is inside one
    // screen. Centred on the viewport it landed at 1640-2200, which is neither.
    for (const at of [
      { x: 10, y: 10 },
      { x: 960, y: 540 },
      { x: 1919, y: 900 },
      { x: 1921, y: 100 },
      { x: 3830, y: 1070 },
    ]) {
      const opened = put(at);
      const inside = SCREENS.some(
        (screen) => opened.x >= screen.x && opened.x + WINDOW.width <= screen.x + screen.width,
      );
      expect(inside, `opened at ${opened.x} for a mark at ${at.x}`).toBe(true);
    }
  });

  test("it stays out of what the desktop has reserved", () => {
    // The dock on the right screen takes 66px, so its middle is not its geometric one.
    const onRight = put({ x: 2800, y: 300 });
    expect(onRight.x).toBeGreaterThanOrEqual(1986);
    expect(onRight.y).toBeGreaterThanOrEqual(32);
  });

  test("a window larger than the room starts inside it rather than above it", () => {
    const huge = centredIn(usable(LEFT), { width: 4000, height: 2000 });
    expect(huge).toEqual({ x: 0, y: 0 });
  });

  test("a render that changes nothing leaves the window's controls alone", () => {
    /*
     * The rail re-renders for reasons that have nothing to do with this window — an
     * agent replying, the five-second look at what every agent is doing. Rebuilding the
     * window on each of those replaces its close button with a new one, and a click
     * needs its press and its release on the *same* element: so the press did nothing,
     * silently, and only sometimes.
     */
    const library = readFileSync(
      new URL("../apps/linux/ui/toolbar-library.js", import.meta.url),
      "utf8",
    );
    const draw = library.slice(library.indexOf("function drawLibrary"));
    const guard = draw.indexOf("=== shown");
    const rebuild = draw.indexOf("replaceChildren");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(rebuild);
    // And what somebody is typing is not part of that comparison: rebuilding on every
    // keystroke would throw away the field they are typing into.
    const signature = draw.slice(draw.indexOf("const asItStands"), guard);
    expect(signature).not.toContain("query");
  });

  test("a press outside the library closes it before anything can be drawn", () => {
    // Without this the glass underneath took the press and began another mark behind the
    // window, so pressing away from it did not dismiss it — it quietly drew.
    const mark = readFileSync(new URL("../apps/linux/ui/toolbar-mark.js", import.meta.url), "utf8");
    const gesture = mark.slice(mark.indexOf("function startGesture"));
    const closes = gesture.indexOf("closeLibrary()");
    const draws = gesture.indexOf("addMark(");
    expect(closes).toBeGreaterThan(-1);
    expect(closes).toBeLessThan(draws);
  });
});

describe("copying what is here, or bringing something in", () => {
  test("only the kinds with somewhere to be brought from are asked", () => {
    // There is no library of wireframes to apply, so a wireframe is always a copy and is
    // never asked the question. Asserted against the whole table so a kind added later
    // is a deliberate answer rather than an omission.
    expect([...TAKES_SOURCE].toSorted()).toEqual(["component", "system"]);
    for (const id of Object.keys(DESIGNS)) {
      const takes = TAKES_SOURCE.includes(id);
      // Every kind that can be brought in needs the sentence for it, and no kind that
      // cannot should have one lying around unused.
      expect(typeof DESIGNS[id]!.brings === "function", id).toBe(takes);
    }
    expect(Object.keys(SOURCES)).toEqual(["copy", "library"]);
  });

  test("a wireframe is a copy however the mark is labelled", () => {
    // A mark can carry a stale source after somebody switches kind, and the kind wins:
    // it is the thing that decides whether the question was ever asked.
    expect(sourceOf({ design: "wireframe", source: "library" })).toBe("copy");
    expect(broughtIn({ design: "wireframe", source: "library", fromLibrary: A_CARD })).toBeNull();
  });

  test("copying is the answer until somebody says otherwise", () => {
    expect(sourceOf({ design: "component" })).toBe("copy");
    expect(sourceOf({ design: "component", source: "library" })).toBe("library");
    // Marks are made by dragging, not by filling in a form, so an unset field has to
    // already be an answer.
    expect(sourceOf({})).toBe("copy");
  });

  const A_CARD = {
    id: "4821",
    name: "Pricing table",
    library: "21st.dev",
    url: "https://21st.dev/someone/pricing-table",
    install: "npx shadcn@latest add pricing-table",
  };

  test("a brought-in mark asks for the thing that was chosen, by name and by id", () => {
    const said = summaryFor(
      [{ tool: "design", design: "component", source: "library", fromLibrary: A_CARD }],
      "build",
      "",
      null,
    );
    expect(said).toContain("Pricing table");
    expect(said).toContain("21st.dev");
    expect(said).toContain("4821");
    expect(said).toContain("npx shadcn@latest add pricing-table");
    // And it is a different request from copying, not the same one with a note.
    expect(said).not.toContain("Build mark-1.png as a component");
  });

  test("the picture is the address, and the agent is told to fit it rather than paste it", () => {
    // The whole risk of this feature: a component dropped in verbatim that matches
    // nothing around it is a component somebody has to rewrite, which is the same thing
    // the copy sentence has always been careful about.
    const said = summaryFor(
      [{ tool: "design", design: "component", source: "library", fromLibrary: A_CARD }],
      "build",
      "",
      null,
    );
    expect(said).toContain("mark-1.png");
    expect(said.toLowerCase()).toContain("neighbours");
  });

  test("a design system brought in reconciles rather than replaces", () => {
    const said = summaryFor(
      [
        {
          tool: "design",
          design: "system",
          source: "library",
          dest: "docs/Design/",
          fromLibrary: { ...A_CARD, name: "Violet" },
        },
      ],
      "build",
      "",
      null,
    );
    expect(said).toContain("Violet");
    expect(said).toContain("docs/Design/");
    expect(said.toLowerCase()).toContain("reconcile");
  });

  test("choosing the library and choosing nothing in it does not send", () => {
    // An agent told to add a component nobody named would go and pick one, which is the
    // toolbar making a design decision out of a field somebody left blank.
    const half = { tool: "design", design: "component", source: "library" };
    expect(unchosen([half])).toContain("nothing is chosen");
    expect(unchosen([half, { ...half }])).toContain("2 marks");
    // And every finished shape sends.
    expect(unchosen([{ ...half, fromLibrary: A_CARD }])).toBeNull();
    expect(unchosen([{ tool: "design", design: "component" }])).toBeNull();
    expect(unchosen([{ tool: "pointAt" }])).toBeNull();
    expect(unchosen([])).toBeNull();
  });

  test("the toolbar never names the call that costs money", () => {
    // Browsing is free metadata; fetching a component's source is paid and counted, and
    // it belongs to the agent doing the work once, on the one thing somebody chose.
    // Asserted across both languages, because either could reach for it.
    const rust = readFileSync(
      new URL("../apps/linux/src-tauri/src/colai_library.rs", import.meta.url),
      "utf8",
    );
    const library = readFileSync(
      new URL("../apps/linux/ui/toolbar-library.js", import.meta.url),
      "utf8",
    );
    for (const [what, source] of [
      // Production only: the Rust tests name it deliberately, to assert it is not asked
      // for, and a check that counted that would be checking itself.
      ["rust", rust.slice(0, rust.indexOf("#[cfg(test)]")).replaceAll(/\/\/[^\n]*/g, "")],
      ["page", library],
    ] as const) {
      expect(source, what).not.toContain("get_component");
    }
  });
});

describe("one light for every agent at once", () => {
  const css = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");

  test("nothing known yet is no light, not a green one", () => {
    // Before the Gateway has answered, the toolbar knows nothing about anybody's work.
    // A light that defaulted to green would be a claim, and the first thing somebody
    // would learn is that it lies.
    expect(moodOf(null)).toBeNull();
    expect(moodOf({ running: 0, waiting: 0, trouble: 0 })).toBeNull();
    expect(moodSaid(null)).not.toContain("working");
  });

  test("worst news wins, because one icon can only say one thing", () => {
    const busy = { running: 3, waiting: 0, trouble: 0 };
    expect(moodOf(busy)).toEqual({ mood: "working", many: 3 });
    // Waiting outranks working: nothing is moving and nothing will until somebody acts.
    expect(moodOf({ ...busy, waiting: 1 })!.mood).toBe("waiting");
    // And trouble outranks both. It is the only one about something that already
    // happened, and the only one nobody would otherwise find out about.
    expect(moodOf({ ...busy, waiting: 1, trouble: 1 })!.mood).toBe("trouble");
  });

  test("the rest is still said, so a red light hides nothing behind it", () => {
    const said = moodSaid({ running: 2, waiting: 1, trouble: 1 });
    expect(said).toContain("a run failed");
    expect(said).toContain("waiting for you");
    expect(said).toContain("2 agents are working");
    // In the order they were ranked, so reading it top to bottom is reading the priority.
    expect(said.indexOf("failed")).toBeLessThan(said.indexOf("waiting"));
    expect(said.indexOf("waiting")).toBeLessThan(said.indexOf("working"));
  });

  test("one of a thing and several read as English, not as a count", () => {
    expect(MOODS.working!.says(1)).toBe("an agent is working");
    expect(MOODS.working!.says(4)).toBe("4 agents are working");
    expect(MOODS.trouble!.says(1)).toBe("a run failed");
  });

  test("every mood the page can show has a colour, and they are three different ones", () => {
    // Read out of the stylesheet, so a mood added here and nowhere else shows as no
    // light at all rather than as a state nobody can see.
    const painted = new Map<string, string>();
    for (const found of css.matchAll(
      /\.home-key\[data-mood="(\w+)"\]\s*\{\s*--mood:\s*([^;]+);/g,
    )) {
      painted.set(found[1]!, found[2]!.trim());
    }
    expect([...painted.keys()].toSorted()).toEqual(Object.keys(MOODS).toSorted());
    expect(new Set(painted.values()).size).toBe(painted.size);
  });

  /**
   * Every script every page of the app loads, and whether it has a scope of its own.
   *
   * Not just the toolbar: Quick Chat and the setup window load scripts too, and a page
   * that cannot parse is a window that does nothing. The toolbar is only the one whose
   * failure takes the desktop with it.
   *
   * The distinction matters. A `type="module"` script gets its own scope, so two of them
   * may freely declare the same name; the toolbar's are classic scripts sharing one
   * global, where that is a fatal redeclaration.
   */
  function everyPageScript(): { page: string; script: string; isModule: boolean }[] {
    const dir = new URL("../apps/linux/ui/", import.meta.url);
    const pages = readdirSync(dir).filter((file) => file.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(1);
    const found: { page: string; script: string; isModule: boolean }[] = [];
    for (const page of pages) {
      const html = readFileSync(new URL(page, dir), "utf8");
      for (const tag of html.matchAll(/<script([^>]*)\ssrc="([^"]+\.js)"/g)) {
        found.push({
          page,
          script: tag[2]!,
          isModule: tag[1]!.includes('type="module"'),
        });
      }
    }
    return found;
  }

  function sourceOfScript(script: string): string {
    return readFileSync(new URL(`../apps/linux/ui/${script}`, import.meta.url), "utf8");
  }

  test("every script every page loads actually parses", () => {
    /*
     * The bug this is about: a second `const mark` in the same function. `toolbar.js`
     * stopped parsing, so nothing in it ran — including the call that tells the overlay
     * what to catch. A transparent always-on-top window the size of every display then
     * kept X's default input region, which is the whole window, and swallowed every
     * click on the desktop. The machine looked completely normal and nothing worked.
     *
     * Every other test here reads these files as text. None would notice that a page
     * cannot be loaded at all, which is the one failure that takes the desktop with it.
     */
    const scripts = everyPageScript();
    expect(scripts.length).toBeGreaterThan(5);
    for (const { script, isModule } of scripts) {
      const source = sourceOfScript(script);
      if (isModule) {
        // Modules may use top-level await and imports, which a classic parse rejects.
        // Node's own checker is the honest arbiter of "would this load".
        expect(() => {
          execFileSync(process.execPath, ["--input-type=module", "--check", "-"], {
            input: source,
            stdio: ["pipe", "ignore", "pipe"],
          });
        }, script).not.toThrow();
      } else {
        // Parses without running, which is exactly what "can the browser load this"
        // means. A redeclaration is a parse error, so it is caught here.
        expect(() => new vm.Script(source, { filename: script }), script).not.toThrow();
      }
    }
  });

  test("classic scripts on one page share a scope, so none may declare the same name twice", () => {
    // The toolbar's twelve files are classic scripts: every top-level `const`, `let` and
    // `function` lands in one global. Two files declaring the same name is the same
    // failure as declaring it twice in one file, and it has bitten this codebase
    // repeatedly — `saying`, `remember`, `chosen`, `back`, and now `mark`.
    //
    // Grouped by page, because that is the boundary a scope actually has, and modules
    // are excluded because each of them has one of its own.
    const byPage = new Map<string, string[]>();
    for (const { page, script, isModule } of everyPageScript()) {
      if (isModule) {
        continue;
      }
      byPage.set(page, [...(byPage.get(page) ?? []), script]);
    }
    expect([...byPage.keys()]).toContain("toolbar.html");

    const clashes: string[] = [];
    for (const [page, scripts] of byPage) {
      const declared = new Map<string, string>();
      for (const script of scripts) {
        // Top-level only: no leading whitespace means column zero means global scope.
        for (const found of sourceOfScript(script).matchAll(/^(?:const|let|function)\s+(\w+)/gm)) {
          const name = found[1]!;
          const already = declared.get(name);
          if (already && already !== script) {
            clashes.push(`${page}: ${name} in both ${already} and ${script}`);
          } else {
            declared.set(name, script);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  test("the reply is sized on purpose, not left to inherit the page", () => {
    /*
     * Found by rendering the window and looking at it: `.answer-turn` set no font-size,
     * so in the Work window it inherited the page default and came out at sixteen pixels
     * while the prompt above it sat at twelve and truncated mid-sentence. The thing you
     * opened the window to read was the one thing nobody had sized.
     */
    const style = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");
    const turns = style.slice(
      style.indexOf(".work-turns .answer-turn {"),
      style.indexOf("}", style.indexOf(".work-turns .answer-turn {")),
    );
    expect(turns, "the agent's reply must carry its own size").toMatch(/font-size:/);
  });

  test("the work window's history scrolls instead of being clipped away", () => {
    /*
     * Also found by looking, and introduced while fixing the above: giving the window
     * `overflow: hidden` without giving history its own scroll silently cut off every
     * entry past the first. A flex child additionally needs `min-height: 0` before it is
     * allowed to shrink far enough to scroll at all, which is the part that is easy to
     * leave out and impossible to see in the rules.
     */
    const style = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");
    const history = style.slice(
      style.indexOf(".work-history {"),
      style.indexOf("}", style.indexOf(".work-history {")),
    );
    expect(history).toMatch(/overflow-y:\s*auto/);
    expect(history, "a flex child cannot scroll until it is allowed to shrink").toMatch(
      /min-height:\s*0/,
    );
  });

  test("the overlay is inert before the page has run a line", () => {
    /*
     * This is the one that turned a broken script into a lost desktop.
     *
     * A new X window's input region is the whole window, and `colai_shape` is only ever
     * called by the page. So between creating a transparent always-on-top window the
     * size of every display and the page's first render, every click on the desktop was
     * being swallowed — and a page that never rendered made that permanent, with nothing
     * visibly wrong.
     *
     * Asserted against the source because the behaviour needs a live GTK window: what
     * matters is that *something other than the page* sets the shape, and that it
     * happens where the window is made.
     */
    const overlay = readFileSync(
      new URL("../apps/linux/src-tauri/src/colai.rs", import.meta.url),
      "utf8",
    );
    const making = overlay.slice(
      overlay.indexOf("pub(crate) fn ensure_overlay"),
      overlay.indexOf("/// Cover every display"),
    );
    expect(making).not.toBe("");
    expect(making, "the overlay must claim its shape as it is built").toMatch(
      /apply_shape\(&window, &\[\]\)/,
    );
  });

  test("it only walks while it is working", () => {
    // A crab merrily scuttling under a red light would be the toolbar contradicting
    // itself. The gait itself is shared now — the pin waiting on a reply walks too — so
    // the mood that earns it is decided in the page rather than in the selector.
    const page = readFileSync(new URL("../apps/linux/ui/toolbar.js", import.meta.url), "utf8");
    expect(page).toContain('mood === "working"');
    // And the mood it walks on is the same one the glow is keyed to, so the gait and the
    // colour can never disagree about whether anything is happening.
    expect(page).toContain("const mood = moodMark(state.atWork);");
  });

  test("a desktop that asked for less movement gets none of it", () => {
    const quiet = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("crab-walk")),
    );
    for (const part of ["crab-leg", "crab-claw", "crab-body"]) {
      expect(quiet.slice(0, 400), part).toContain(part);
    }
  });
});

describe("what the send key can do with what is marked", () => {
  const rail = readFileSync(new URL("../apps/linux/ui/toolbar-rail.js", import.meta.url), "utf8");

  test("a right click asks which, rather than choosing one", () => {
    // It used to drop straight into the schedule, so the second thing this key does was
    // the only thing the gesture reached — and sending, the thing the key is named
    // after, was not on the menu it opened.
    const handler =
      rail.match(/send\.addEventListener\("contextmenu"[\s\S]*?\n {2}\}\);/)?.[0] ?? "";
    expect(handler).toContain('flyout("how")');
    expect(handler).not.toContain('flyout("automate")');
  });

  test("both of the things it can do are on that menu", () => {
    const rows = [...rail.matchAll(/howRow\(\s*"(\w+)",\s*\n?\s*"([^"]+)"/g)].map(
      (found) => found[2]!,
    );
    expect(rows.length).toBe(2);
    expect(rows.join(" | ")).toMatch(/Send now/);
    expect(rows.join(" | ")).toMatch(/automation/i);
  });
});

describe("a list longer than the screen", () => {
  const css = readFileSync(new URL("../apps/linux/ui/toolbar.css", import.meta.url), "utf8");
  const compose = readFileSync(
    new URL("../apps/linux/ui/toolbar-compose.js", import.meta.url),
    "utf8",
  );

  test("every long list in a menu scrolls, by the one rule that says how", () => {
    // A menu can hold forty prompts or a dozen conversations, and either runs off the
    // bottom of the screen. One spelling of "scrolls", so the second list built here
    // cannot quietly be the one that does not.
    expect(css).toMatch(/\.scrolls \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.scrolls \{[^}]*max-height/);
    const rule = css.match(/\.scrolls \{[^}]*\}/)?.[0] ?? "";
    // Held inside itself rather than passing the scroll on to the desktop underneath.
    expect(rule).toContain("overscroll-behavior: contain");
  });

  test("the prompts scroll, and the sentence above them does not", () => {
    // What that sentence says — this touches the conversation, not the files — has to
    // still be on screen at the moment somebody picks a row. A panel that scrolls whole
    // is one where the warning has left the screen by the time it matters.
    expect(compose).toContain('list.className = "prompt-list scrolls"');
    const bare = compose.indexOf("bare.textContent = REWIND_SAYS");
    const scroller = compose.indexOf('"prompt-list scrolls"');
    expect(bare).toBeGreaterThan(-1);
    expect(scroller).toBeGreaterThan(bare);
  });
});

describe("every tool has a key somebody can find", () => {
  const rail = readFileSync(new URL("../apps/linux/ui/toolbar-rail.js", import.meta.url), "utf8");
  const keys = new Set([...rail.matchAll(/\bkey\("(\w+)"/g)].map((found) => found[1]!));
  const folds = (rail.match(/const EXACT = \[([^\]]+)\]/)?.[1] ?? "")
    .split(",")
    .map((name) => name.trim().replaceAll('"', ""))
    .filter(Boolean);

  test("a tool is reached from the rail, not from inside another tool's menu", () => {
    // Screenshot used to be a row at the bottom of the Design menu — reachable, and
    // findable only by somebody who had already opened a menu named after wireframes.
    // That is not a placement anybody chose; it is one nothing was checking.
    //
    // Read out of the rail source, so a tool added to the table and never given a key
    // fails here rather than existing only in the code that sends it.
    for (const tool of Object.keys(TOOLS)) {
      if (tool === "surfaceWrite") {
        continue;
      }
      // Box and circle share one key, which opens onto both under their own names.
      const shared = tool === "box" || tool === "circle";
      expect(keys.has(tool) || (shared && keys.has("shape")), `${tool} has a key`).toBe(true);
    }
  });

  test("the fold key names every tool it folds away", () => {
    // It is the only label somebody reads before deciding whether what they want is
    // behind it, so a label that says less than it hides is how a tool goes missing.
    const named = rail.match(/key\("exact", "([^"]+)"/)?.[1] ?? "";
    expect(folds.length).toBeGreaterThan(0);
    for (const tool of folds) {
      expect(named.toLowerCase(), tool).toContain(tool);
    }
  });
});

describe("marking several things before saying anything", () => {
  test("annotating accumulates; answering a question does not", () => {
    // Asserted against the whole tool table rather than as a list, so a tool added later
    // is not silently left out of the decision — which is how a rule like this rots.
    expect([...KEEPS_MARKING].toSorted()).toEqual(["box", "circle", "draw", "pointAt"]);
    for (const tool of Object.keys(TOOLS)) {
      const accumulates = KEEPS_MARKING.includes(tool);
      // Every one of these answers one question in one go. Nobody makes three colour
      // readings before saying anything about them.
      const answers = ["measure", "colour", "record", "screenshot", "design"];
      if (answers.includes(tool)) {
        expect(accumulates, tool).toBe(false);
      }
    }
  });

  test("the pointer is not a marking tool and does not accumulate", () => {
    expect(KEEPS_MARKING).not.toContain("pointer");
  });

  test("a mark is called the same thing on the glass and in the message", () => {
    // The bug this replaces: pins counted only pins while the message numbered every
    // mark, so a box followed by a pin showed "1" on screen and was called "2" in the
    // words. Nobody saw it with one mark on screen.
    const marks = [{ tool: "box" }, { tool: "pointAt" }, { tool: "circle" }];
    const said = summaryFor(marks, "ask", "", null);
    for (const [at, mark] of marks.entries()) {
      const number = numberOf(marks, mark);
      expect(number).toBe(at + 1);
      expect(said).toContain(`${number}. `);
    }
    // And the pin — the one that used to count for itself — is the second of the three.
    expect(numberOf(marks, marks[1])).toBe(2);
  });

  test("a mark that is not in the list has no number", () => {
    expect(numberOf([{ tool: "box" }], { tool: "circle" })).toBeNull();
    expect(numberOf([], { tool: "box" })).toBeNull();
    expect(numberOf(undefined, { tool: "box" })).toBeNull();
  });

  test("the number is what the agent will call it, so unticking renumbers", () => {
    // The message numbers what is sent. A mark left out is not going anywhere and the
    // agent will never call it anything, so it wears no number — and the ones that are
    // going close up behind it rather than leaving a hole somebody has to map across.
    const kept = { tool: "box", chosen: true };
    const left = { tool: "pointAt", chosen: false };
    const also = { tool: "circle", chosen: true };
    const marks = [kept, left, also];
    expect(numberOf(marks, kept)).toBe(1);
    expect(numberOf(marks, left)).toBeNull();
    expect(numberOf(marks, also)).toBe(2);

    // And that is exactly what the message says, because only the chosen ones are sent.
    const said = summaryFor([kept, also], "ask", "", null);
    expect(said).toContain("1. Box");
    expect(said).toContain("2. Circle");
    expect(said).not.toContain("Point at");
  });
});
