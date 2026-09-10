// Putting the toolbar on the screen, and taking it off again.
//
// Its own module because it is the riskiest part of the plugin and the only part with a
// real process in it: everything else here decides something, this one starts and stops a
// window somebody is looking at. It takes the binary as an argument rather than finding
// it, so the decisions above stay decisions and this stays mechanics.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { toolbarOnScreen } from "./running.js";

/** How long a toolbar gets to leave politely before it is killed. */
const STOP_PATIENCE = 3_000;

/** Enough of a logger to say what happened; the Gateway's own, in practice. */
type Says = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

/** One toolbar, from the moment it is asked for to the moment it is gone. */
export class Toolbar {
  /** The process this started, if it started one. */
  private mine: ChildProcess | null = null;
  /** A toolbar this did not start but is responsible for stopping. */
  private adopted: number | null = null;

  /**
   * Put it on the screen, unless one is already there.
   *
   * A Gateway that was killed rather than stopped comes back to find its toolbar still
   * running. That one is adopted rather than spawned over: spawning would hand its
   * arguments to the copy on screen and exit, and then nothing here could stop the
   * toolbar somebody is actually looking at.
   */
  start(binary: string, log: string, says: Says): void {
    const already = toolbarOnScreen(binary);
    if (already) {
      this.adopted = already.pid;
      says.info(`colai: a toolbar was already running (pid ${already.pid}).`);
      return;
    }

    /*
     * Everything the toolbar ever says goes to that file.
     *
     * It used to go to `stdio: "ignore"`, under a comment claiming its output belonged in
     * its own log — there was no such log. A machine with no `openclaw` on PATH got a
     * toolbar whose every menu was empty and no artifact anywhere saying why, because the
     * line explaining it was written to /dev/null.
     *
     * Appended, not truncated: the interesting run is usually the one before the one
     * somebody is looking at.
     */
    let sink: number | "ignore" = "ignore";
    try {
      mkdirSync(dirname(log), { recursive: true });
      sink = openSync(log, "a");
    } catch (error) {
      // A log nobody can write is not a reason to withhold the toolbar.
      says.warn(`colai: could not open ${log}: ${String(error)}`);
    }

    // Detached: this is a window somebody looks at for hours, and closing the Gateway
    // should not take it off the screen mid-sentence.
    const started = spawn(binary, ["show"], { detached: true, stdio: ["ignore", sink, sink] });
    started.unref();
    this.mine = started;
    started.once("exit", (code, signal) => {
      // A handoff to an instance already up exits 0 immediately, and that is a success —
      // the toolbar somebody can see is the one that was already there.
      const handedOff = signal === null && code === 0;
      if (signal !== "SIGTERM" && !handedOff) {
        says.warn(`colai: the toolbar exited (${signal ?? code}). Its log is ${log}`);
      }
      if (this.mine === started) {
        this.mine = null;
      }
    });
    says.info(`colai: toolbar started. Its log is ${log}`);
  }

  /**
   * Take it off the screen, and do not come back until it is gone.
   *
   * The wait is the point. The toolbar holds a session-bus name until it actually exits,
   * so a restart that spawns before then hands its arguments to the dying copy, that copy
   * exits too, and nobody is left on screen — with `colai: toolbar started.` in the log.
   */
  async stop(): Promise<void> {
    const going = this.mine;
    const pid = this.mine?.pid ?? this.adopted;
    this.mine = null;
    this.adopted = null;
    if (!pid) {
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone, which is the outcome this wanted.
      return;
    }
    if (!going) {
      // Adopted: there is no `exit` to wait on, only a pid to stop watching.
      return;
    }
    await new Promise<void>((done) => {
      const giveUp = setTimeout(() => {
        // It had its chance. A toolbar that will not go is worse than one killed.
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Raced us to it.
        }
        done();
      }, STOP_PATIENCE);
      going.once("exit", () => {
        clearTimeout(giveUp);
        done();
      });
    });
  }
}
