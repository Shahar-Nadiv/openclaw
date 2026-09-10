// `openclaw colai` — show the toolbar, put it away, or say where it stands.
//
// `toggle` is the control surface for everything that is not the tray icon: a terminal,
// a launcher, a keyboard shortcut, a script. It matters most where the tray is not there
// to help — a GNOME session with no AppIndicator extension shows no icon at all, and then
// this is the only way back after Escape.
//
// Reaching the running toolbar costs nothing here. It refuses to run twice, and a second
// launch hands its arguments to the copy already on screen — so "tell the toolbar
// something" and "start the toolbar" are the same command, and there is no socket, port
// or protocol between them.
//
// Status lives here rather than in a doctor check because doctor cannot ask:
// `registerBundledHealthChecks` names five bundled plugins and has no seam for an
// installed one, and a plugin's `register` does not run in the doctor process at all.
// A plugin's own command does load the plugin, so this works from an ordinary terminal.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { toolbarOnScreen, whereabouts } from "./running.js";

type CliProgram = Parameters<Parameters<OpenClawPluginApi["registerCli"]>[0]>[0]["program"];

function megabytes(path: string): string {
  try {
    return `${Math.round(statSync(path).size / 1_000_000)}MB`;
  } catch {
    // Raced an update that unlinked it. The size is a courtesy, not the answer.
    return "size unknown";
  }
}

/**
 * Hand one word to the toolbar, starting it if it is not up.
 *
 * Detached and unwaited, because this returns a menu to the person who opened it: the
 * toolbar outlives the command that spoke to it, and holding the terminal until a window
 * closes would be the wrong shape for both callers.
 */
function tellTheToolbar(binary: string, word: "show" | "hide" | "toggle" | "quit"): void {
  // The pidfile travels with every word, so a toolbar started from here records itself
  // the same way one started by the plugin does.
  spawn(binary, [word, "--pidfile", whereabouts()], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

export function registerColaiCli(program: CliProgram, toolbarBinary: () => string | null): void {
  const colai = program.command("colai").description("Show the colai toolbar, or put it away");

  /** Every subcommand needs the binary, and none of them can do anything without it. */
  const theToolbar = (): string | null => {
    const binary = toolbarBinary();
    if (binary && existsSync(binary)) {
      return binary;
    }
    console.error("The colai toolbar is not installed.");
    console.error("The package ships it already built, so this means the install did not finish.");
    console.error("Reinstall it: openclaw plugins install @colai/toolbar --force");
    process.exitCode = 1;
    return null;
  };

  for (const [word, description] of [
    ["show", "Put the toolbar on screen"],
    ["hide", "Take the toolbar off screen"],
    ["toggle", "Put the toolbar on screen, or take it off"],
    ["quit", "Close the toolbar entirely"],
  ] as const) {
    colai
      .command(word)
      .description(description)
      .action(() => {
        const binary = theToolbar();
        if (binary) {
          tellTheToolbar(binary, word);
        }
      });
  }

  colai
    .command("status", { isDefault: true })
    .description("Show whether the toolbar is installed and on screen")
    .action(() => {
      const binary = theToolbar();
      if (!binary) {
        return;
      }
      console.log(`Toolbar: ${binary} (${megabytes(binary)})`);

      // Asked only where it has an answer. A missing X display is the ordinary case on a
      // Linux server; on a desktop that is not optional the question does not arise.
      if (process.platform === "linux" && !process.env.DISPLAY) {
        console.log("Screen:  none — DISPLAY is not set, so there is nothing to draw on.");
        return;
      }
      console.log(`Screen:  ${process.env.DISPLAY || process.platform}`);

      const found = toolbarOnScreen(whereabouts());
      if (found === null) {
        console.log("Running: no.");
        console.log("Put it on screen: openclaw colai show");
        return;
      }
      // Running is all this can honestly say. Whether the overlay is drawn right now is
      // inside that process — asking X would mean a window-manager dependency to answer
      // a question `toggle` already answers correctly by asking the window itself.
      console.log(`Running: yes (pid ${found.pid}).`);
      console.log("On screen or put away: openclaw colai toggle");
    });
}
