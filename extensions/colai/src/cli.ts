// `openclaw colai` — is the toolbar there, and is it on screen?
//
// This is where the question is answered, rather than in a doctor check, because doctor
// cannot ask it. `registerBundledHealthChecks` names the five bundled plugins that
// contribute doctor checks and there is no seam for an installed one, so a health check
// registered here is only ever registered inside the Gateway process — which is not the
// process `openclaw doctor` runs in. A check nobody can run is worse than no check.
//
// A plugin's own command does load the plugin, so this works from an ordinary terminal.

import { existsSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

type CliProgram = Parameters<Parameters<OpenClawPluginApi["registerCli"]>[0]>[0]["program"];

/** A toolbar somebody is looking at right now, and whether it came from this install. */
function toolbarOnScreen(binary: string): { pid: number; thisCopy: boolean } | null {
  // Asked of the process table rather than remembered, because the toolbar outlives the
  // Gateway that started it: it is spawned detached so that closing one does not close
  // the other, and a remembered pid would be a guess as soon as either restarts.
  //
  // Any colai-toolbar counts, not only this one. An update stages the new copy under a
  // new directory while the copy from before it is still on screen, which is a state
  // anybody who just ran `plugins install` is in — and "not running" would be a lie.
  let older: number | null = null;
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) {
      continue;
    }
    let running: string;
    try {
      running = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // Somebody else's process, or one that ended mid-read. Neither is our answer.
      continue;
    }
    if (running === binary) {
      return { pid, thisCopy: true };
    }
    if (basename(running) === "colai-toolbar") {
      older = pid;
    }
  }
  return older === null ? null : { pid: older, thisCopy: false };
}

function megabytes(path: string): string {
  return `${Math.round(statSync(path).size / 1_000_000)}MB`;
}

export function registerColaiCli(program: CliProgram, toolbarBinary: () => string | null): void {
  program
    .command("colai")
    .description("Show whether the colai toolbar is installed and on screen")
    .action(() => {
      const binary = toolbarBinary();
      if (!binary || !existsSync(binary)) {
        console.error("The colai toolbar is not installed.");
        console.error(
          "The package ships it already built, so this means the install did not finish.",
        );
        console.error("Reinstall it: openclaw plugins install @colai/toolbar --force");
        process.exitCode = 1;
        return;
      }
      console.log(`Toolbar: ${binary} (${megabytes(binary)})`);

      if (!process.env.DISPLAY) {
        // Said before the process table, because on a headless host "not running" is the
        // correct outcome rather than a fault to chase.
        console.log("Screen:  none — DISPLAY is not set, so there is nothing to draw on.");
        return;
      }
      console.log(`Screen:  ${process.env.DISPLAY}`);

      const found = toolbarOnScreen(binary);
      if (found === null) {
        console.log("Running: no.");
        console.log("It opens with OpenClaw. Start it: openclaw gateway restart");
        console.log(
          "Or leave it closed for good: openclaw config set plugins.entries.colai.config.autostart false",
        );
        return;
      }
      if (!found.thisCopy) {
        // The state anybody is in immediately after `plugins install`: the toolbar they
        // can see is the one from before it.
        console.log(`Running: an older copy (pid ${found.pid}).`);
        console.log("Restart OpenClaw to pick this one up: openclaw gateway restart");
        return;
      }
      console.log(`Running: yes (pid ${found.pid}).`);
      console.log("Put it away or bring it back from the colai icon in the system tray.");
    });
}
