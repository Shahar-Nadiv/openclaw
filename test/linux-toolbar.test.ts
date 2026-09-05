// Exercises the pure decisions extracted from the Linux toolbar webview script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it as test } from "vitest";

const toolbarSource = readFileSync(new URL("../apps/linux/ui/toolbar.js", import.meta.url), "utf8");
const browserBindingsStart = toolbarSource.indexOf("const tauri = window");
assert.notEqual(browserBindingsStart, -1, "toolbar pure-helper boundary");

type Point = { x: number; y: number };
type Reserved = { top: number; right: number; bottom: number; left: number };
type Surface = { app: string; connector: string | null } | null;

type ToolbarHelpers = {
  TOOLS: Record<string, { label: string; writes: boolean }>;
  DRAWS: Record<string, string>;
  dockFor: (
    box: { x: number; y: number; width: number; height: number },
    screen: { width: number; height: number },
    reserved?: Reserved,
  ) => string | null;
  usable: (
    screen: { width: number; height: number },
    reserved?: Reserved,
  ) => { left: number; top: number; right: number; bottom: number };
  boxOf: (points: Point[]) => { x: number; y: number; w: number; h: number };
  pathFor: (shape: { kind: string; points: Point[] } | null) => string;
  receiptFor: (
    tool: string,
    surface: Surface,
    agent: string | null,
  ) => { did: string; through: string; agent: string | null; blocked: boolean };
  counted: (many: number, noun: string) => string;
};

const context: { helpers?: ToolbarHelpers } & Record<string, unknown> = {};
vm.runInNewContext(
  `${toolbarSource.slice(0, browserBindingsStart)}\nthis.helpers = { TOOLS, DRAWS, dockFor, usable, boxOf, pathFor, receiptFor, counted };`,
  context,
);
const { TOOLS, DRAWS, dockFor, usable, boxOf, pathFor, receiptFor, counted } =
  context.helpers as ToolbarHelpers;

describe("what a tool is allowed to do", () => {
  // The whole point of the toolbar: it reads anything and changes only what a connector
  // owns. That difference is data so this test and the rail read the same list.
  test("only the tools that change a surface are marked as writing", () => {
    expect(TOOLS.wireframe.writes).toBe(true);
    for (const marking of ["pointer", "pointAt", "draw", "box", "circle", "screenshot"]) {
      expect(TOOLS[marking]!.writes, marking).toBe(false);
    }
  });

  test("every drawing tool has a shape, and the pointer has none", () => {
    expect(DRAWS.box).toBe("box");
    expect(DRAWS.circle).toBe("ellipse");
    expect(DRAWS.draw).toBe("stroke");
    expect(DRAWS.pointer).toBeUndefined();
  });
});

describe("the receipt", () => {
  const connected: Surface = { app: "Figma", connector: "canvas-bridge" };
  const bare: Surface = { app: "Notes", connector: null };

  test("a write on an unconnected surface is refused and says so", () => {
    const said = receiptFor("wireframe", bare, "Ada");
    expect(said.blocked).toBe(true);
    expect(said.did).toContain("Notes isn't connected");
    // The sentence the product turns on: the region was noticed, and nothing changed.
    expect(said.through).toBe("Region noted, nothing changed");
  });

  test("not knowing what is in front is not permission", () => {
    expect(receiptFor("wireframe", null, null).blocked).toBe(true);
  });

  test("marking works everywhere, connector or not", () => {
    expect(receiptFor("pointAt", bare, "Ada").blocked).toBe(false);
    expect(receiptFor("box", null, null).blocked).toBe(false);
  });

  test("a write through a connector names the connector", () => {
    const said = receiptFor("wireframe", connected, "Ada");
    expect(said.blocked).toBe(false);
    expect(said.through).toBe("canvas-bridge");
  });
});

describe("where the rail sits", () => {
  const screen = { width: 1440, height: 900 };
  const bar = { width: 420, height: 48 };

  test("docks to whichever edge it is dragged near", () => {
    expect(dockFor({ x: 12, y: 400, ...bar }, screen)).toBe("left");
    expect(dockFor({ x: 1000, y: 400, ...bar }, screen)).toBe("right");
    expect(dockFor({ x: 500, y: 20, ...bar }, screen)).toBe("top");
    expect(dockFor({ x: 500, y: 870, ...bar }, screen)).toBe("bottom");
    expect(dockFor({ x: 500, y: 400, ...bar }, screen)).toBeNull();
  });

  /*
   * A desktop's own panels are drawn above every window by the compositor, so a rail
   * docked flush to a screen edge is simply hidden under one. Measuring from the room
   * that is left is what keeps both visible.
   */
  test("measures edges from the room it has, not the screen", () => {
    const dock = { top: 32, right: 0, bottom: 0, left: 66 };
    expect(dockFor({ x: 70, y: 400, ...bar }, screen, dock)).toBe("left");
    expect(dockFor({ x: 200, y: 400, ...bar }, screen, dock)).toBeNull();
    expect(dockFor({ x: 500, y: 40, ...bar }, screen, dock)).toBe("top");
  });

  test("reports the room left over", () => {
    expect(usable(screen, { top: 32, right: 0, bottom: 0, left: 66 })).toEqual({
      left: 66,
      top: 32,
      right: 1440,
      bottom: 900,
    });
    expect(usable(screen)).toEqual({ left: 0, top: 0, right: 1440, bottom: 900 });
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
