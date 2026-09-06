// Exercises the pure decisions extracted from the Linux toolbar webview script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  pathFor: (shape: { kind: string; points: Point[] } | null) => string;
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
};

/** A file or folder somebody dropped on the toolbar, as the page holds it. */
type Brought = { path: string; name: string; bytes: number; folder: boolean };

const context: { helpers?: ToolbarHelpers } & Record<string, unknown> = {};
vm.runInNewContext(
  `${toolbarSource}\nthis.helpers = { TOOLS, DRAWS, dockFor, usable, boxOf, pathFor, gateFor, counted, MODES, summaryFor, screenAt, spanOf, detailOf, projectInFront, RECORD_LENGTHS, carrying, sizeOf, secondsLeft, recordFrame, RECORD_CLEAR };`,
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
    expect(DRAWS.wireframe).toBe("box");
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

  test("creating a wireframe is not refused, because it changes no surface", () => {
    // It asks an agent for a document. Refusing it on an unconnected window would be
    // the gate answering a question nobody asked.
    expect(gateFor("wireframe", bare).blocked).toBe(false);
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
    expect(said).toContain("2 things marked on Openclaw Desktop:");
    // The number, the tool and the file name travel together, because three images
    // arriving as a set are only tellable apart by their names.
    expect(said).toContain("1. Box (mark-1.png) — this padding is wrong");
    expect(said).toContain("2. Point at (mark-2.png)");
  });

  test("one thing is one thing, not 1 things", () => {
    expect(summaryFor([{ tool: "circle" }], "ask", "", surface)).toContain(
      "One thing marked on Openclaw Desktop:",
    );
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

  test("a wireframe says where its document goes, and every wireframe says it once", () => {
    const said = summaryFor(
      [{ tool: "wireframe", dest: "docs/Design/rail.dc.html" }, { tool: "wireframe" }],
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

  test("not knowing what is in front does not invent an application", () => {
    expect(summaryFor([{ tool: "box" }], "plan", "", null)).toContain(
      "One thing marked on screen:",
    );
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

  test("a comparison adds nothing, because its name already said it", () => {
    // The tool is called "Before and after" and its two files are in order. Repeating
    // that under the title is the toolbar talking to itself.
    expect(detailOf({ tool: "compare", frames: 2 })).toBeNull();
  });

  test("one frame is not a sequence", () => {
    expect(detailOf({ tool: "record", frames: 1, seconds: 2 })).toBeNull();
    expect(detailOf({ tool: "box", frames: 1 })).toBeNull();
  });

  test("the message names a run as a range so the agent reads it in order", () => {
    const said = summaryFor(
      [{ tool: "record", frames: 6, seconds: 2 }, { tool: "box" }],
      "debug",
      "",
      { app: "Figma", connector: null },
    );
    expect(said).toContain("1. Recording (mark-1-1.png … mark-1-6.png) — 6 frames over 2s");
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

describe("what the desktop says is there", () => {
  const seen = {
    role: "push button",
    name: "Send",
    at: [412, 88, 96, 32],
    within: ["panel “Composer”", "frame “OpenClaw”"],
  };

  test("an element reads as a sentence, role first", () => {
    // The role is the part a picture cannot be read for. "A red button near the top"
    // is a guess about something the desktop already knows exactly.
    expect(detailOf({ tool: "inspect", seen })).toBe(
      "push button “Send”, 96×32 at 412,88, in panel “Composer” in frame “OpenClaw”",
    );
  });

  test("an element with no name is still its role and its place", () => {
    expect(
      detailOf({ tool: "inspect", seen: { role: "filler", name: "", at: [0, 0, 10, 4] } }),
    ).toBe("filler, 10×4 at 0,0");
  });

  test("a window that exposes nothing says so, rather than saying nothing", () => {
    // An agent told nothing about structure knows it is reading pixels. An agent told
    // something vague does not, and will believe it.
    expect(detailOf({ tool: "inspect", seen: null })).toBe("this window exposes no structure");
    expect(detailOf({ tool: "inspect" })).toBe("this window exposes no structure");
  });

  test("an element with no size is a point, not a zero-sized box", () => {
    expect(
      detailOf({ tool: "inspect", seen: { role: "caret", name: "", at: [700, 400, 0, 0] } }),
    ).toBe("caret, at 700,400");
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
   * The overlay draws the recording frame in the page and the pictures are cropped in
   * Rust, so the two halves of "do not photograph your own outline" live in different
   * languages and cannot check each other at compile time. Reading the number from its
   * own source is what stops a change on one side from silently putting a red rectangle
   * into every frame of every recording on the other.
   */
  const capture = readFileSync(
    new URL("../apps/linux/src-tauri/src/colai_capture.rs", import.meta.url),
    "utf8",
  );
  const room = /const OUTLINE_ROOM: f64 = ([\d.]+);/.exec(capture);
  assert.ok(room, "OUTLINE_ROOM in colai_capture.rs");
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
