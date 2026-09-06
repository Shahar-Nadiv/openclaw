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
  detailOf: (mark: { tool: string; px?: number; hex?: string; frames?: number }) => string | null;
  summaryFor: (
    marks: {
      tool: string;
      note?: string;
      dest?: string;
      px?: number;
      hex?: string;
      frames?: number;
    }[],
    mode: string,
    text: string,
    surface: Surface,
  ) => string;
};

const context: { helpers?: ToolbarHelpers } & Record<string, unknown> = {};
vm.runInNewContext(
  `${toolbarSource}\nthis.helpers = { TOOLS, DRAWS, dockFor, usable, boxOf, pathFor, gateFor, counted, MODES, summaryFor, screenAt, spanOf, detailOf };`,
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
      if (tool === "surfaceWrite") continue;
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
    expect(detailOf({ tool: "record", frames: 6 })).toBe("6 frames over 1.8s");
  });

  test("a comparison adds nothing, because its name already said it", () => {
    // The tool is called "Before and after" and its two files are in order. Repeating
    // that under the title is the toolbar talking to itself.
    expect(detailOf({ tool: "compare", frames: 2 })).toBeNull();
  });

  test("one frame is not a sequence", () => {
    expect(detailOf({ tool: "record", frames: 1 })).toBeNull();
    expect(detailOf({ tool: "box", frames: 1 })).toBeNull();
  });

  test("the message names a run as a range so the agent reads it in order", () => {
    const said = summaryFor([{ tool: "record", frames: 6 }, { tool: "box" }], "debug", "", {
      app: "Figma",
      connector: null,
    });
    expect(said).toContain("1. Recording (mark-1-1.png … mark-1-6.png) — 6 frames over 1.8s");
    // A mark that photographed once keeps the plain name it always had.
    expect(said).toContain("2. Box (mark-2.png)");
  });
});
