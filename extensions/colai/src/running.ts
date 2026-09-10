// Is a toolbar on this machine right now, and is it the one we would start?
//
// Asked of the process table rather than remembered, because the toolbar outlives the
// Gateway that started it: it is spawned detached so that closing one does not close the
// other, and a remembered pid is a guess as soon as either restarts. A Gateway that was
// killed rather than stopped comes back to find its toolbar still on screen, and it has
// to recognise it — otherwise it spawns a second copy that hands off and exits, and then
// nothing can stop the one somebody is looking at.

import { readdirSync, readlinkSync } from "node:fs";

/** A toolbar somebody is looking at, and whether it came from this install. */
export type ToolbarOnScreen = { pid: number; thisCopy: boolean };

/**
 * How much of a path has to match for a process to count as another copy of this plugin.
 *
 * An installed toolbar sits at `.../@colai/toolbar/bin/colai-toolbar`, and OpenClaw puts
 * each install in its own generation directory — so the copy from before an update
 * differs from this one only above those last segments. Matching on the file name alone
 * would be far too eager: it would claim anything called `colai-toolbar` anywhere,
 * including a file somebody dropped in `/tmp`, and stopping "the toolbar" would then kill
 * a stranger's process.
 */
const ENOUGH_OF_THE_PATH = 3;

function tail(path: string): string {
  return path.split("/").slice(-ENOUGH_OF_THE_PATH).join("/");
}

export function toolbarOnScreen(binary: string): ToolbarOnScreen | null {
  const ours = tail(binary);
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
    // An in-place update unlinks the running binary, and Linux answers the readlink with
    // the old path plus " (deleted)". Without this, `plugins install --force` makes the
    // toolbar on screen invisible to us — which is exactly when we most need to see it.
    const real = running.replace(/ \(deleted\)$/, "");
    if (real === binary) {
      return { pid, thisCopy: true };
    }
    if (real !== binary && tail(real) === ours) {
      older = pid;
    }
  }
  return older === null ? null : { pid: older, thisCopy: false };
}
