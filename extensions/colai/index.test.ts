// The plugin entry, loaded and registered the way the Gateway loads it.
//
// Everything else about colai is checked by reading files. This is the one test that
// runs `register`, because the failure it protects against — a plugin that installs,
// loads, and quietly registers nothing — leaves no other trace.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it as test } from "vitest";
import colai from "./index.js";
import { notWhatWasBuilt } from "./src/digest.js";
import { Toolbar } from "./src/toolbar-process.js";

type Service = { id: string; start: (ctx: unknown) => void; stop?: (ctx: unknown) => void };
type CliRegistration = { descriptors?: { name: string }[] };

/** Register the plugin against a host that records what it was handed. */
function registerColai(config: Record<string, unknown> = {}) {
  const services: Service[] = [];
  const commands: string[] = [];
  const said: string[] = [];
  const logger = {
    info: (message: string) => said.push(message),
    warn: (message: string) => said.push(message),
    error: (message: string) => said.push(message),
    debug: () => {},
  };
  colai.register?.(
    createTestPluginApi({
      id: "colai",
      pluginConfig: config,
      logger,
      registerService: (service) => services.push(service as Service),
      registerCli: (_registrar, options) => {
        for (const descriptor of (options as CliRegistration)?.descriptors ?? []) {
          commands.push(descriptor.name);
        }
      },
    }),
  );
  return {
    services,
    commands,
    said,
    ctx: { logger, stateDir: mkdtempSync(join(tmpdir(), "colai-state-")) },
  };
}

describe("the plugin OpenClaw loads", () => {
  test("it registers one service and one command", () => {
    const { services, commands } = registerColai();
    expect(services.map((service) => service.id)).toEqual(["colai-toolbar"]);
    // `openclaw colai` is how anybody outside the Gateway finds out whether the toolbar
    // is there. Without it there is no answer at all: doctor cannot load this plugin.
    expect(commands).toEqual(["colai"]);
  });

  test("the reload declaration names the setting it reloads for", () => {
    /*
     * `autostart` is the one thing that should move the toolbar without a restart, and
     * the service says so by naming the exact config path. A prefix that does not match
     * the manifest's option is a toggle that appears to do nothing until the next
     * Gateway restart, which is exactly the shape of bug nobody reports.
     */
    const { services } = registerColai();
    const service = services[0] as Service & { reload?: { configPrefixes?: string[] } };
    expect(service.reload?.configPrefixes).toEqual(["plugins.entries.colai.config.autostart"]);
    const declared = JSON.parse(
      readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as { id: string; configSchema?: { properties?: Record<string, unknown> } };
    const prefix = service.reload?.configPrefixes?.[0] ?? "";
    expect(prefix).toBe(`plugins.entries.${declared.id}.config.autostart`);
    expect(Object.keys(declared.configSchema?.properties ?? {})).toContain("autostart");
  });

  test("autostart off leaves the toolbar alone, and says so", () => {
    const { services, said, ctx } = registerColai({ autostart: false });
    services[0]?.start(ctx);
    expect(said.join("\n")).toContain("autostart is off");
  });

  test("with no screen it starts nothing rather than failing into one", () => {
    /*
     * The overlay is X11. On a headless host — a server, a container, a CI runner — the
     * honest outcome is a line in the log, not a crash inside a window system that was
     * never there.
     */
    const display = process.env.DISPLAY;
    delete process.env.DISPLAY;
    try {
      const { services, said, ctx } = registerColai();
      services[0]?.start(ctx);
      expect(said.join("\n")).toContain("no DISPLAY");
    } finally {
      if (display === undefined) {
        delete process.env.DISPLAY;
      } else {
        process.env.DISPLAY = display;
      }
    }
  });

  test("stopping before anything started is not an error", async () => {
    const { services, ctx } = registerColai({ autostart: false });
    await expect(services[0]?.stop?.(ctx)).resolves.toBeUndefined();
  });
});

describe("what gets spawned is what was built", () => {
  /*
   * The package ships a native program that runs as the user, photographs the screen and
   * authenticates to the Gateway, and npm proves nothing about what is inside a tarball.
   * So the build writes a digest beside the binary and the plugin checks it before
   * anything runs.
   *
   * Not a signature — whoever can replace the binary can replace the digest next to it.
   * What it closes is the narrower case, an artifact tampered with in transit or on disk,
   * and it turns a silent substitution into a refusal.
   */
  function staged(bytes: string, digest?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "colai-digest-"));
    const binary = join(dir, "colai-toolbar");
    writeFileSync(binary, bytes);
    if (digest !== undefined) {
      writeFileSync(`${binary}.sha256`, `${digest}\n`);
    }
    return binary;
  }

  const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

  test("a binary that matches its digest is allowed through", () => {
    expect(notWhatWasBuilt(staged("toolbar", sha("toolbar")))).toBeNull();
  });

  test("a swapped binary is refused, and says both digests", () => {
    const refusal = notWhatWasBuilt(staged("swapped", sha("toolbar")));
    expect(refusal).toContain("does not match the digest");
    expect(refusal).toContain(sha("swapped"));
    expect(refusal).toContain(sha("toolbar"));
  });

  test("a developer build with no digest beside it still runs", () => {
    // Straight out of `target/`, never staged, nothing to compare against. Refusing it
    // would mean refusing to run the thing somebody just compiled.
    expect(notWhatWasBuilt(staged("freshly compiled"))).toBeNull();
  });
});

describe("the toolbar's lifetime, against a real process", () => {
  /*
   * The riskiest code in the plugin, and nothing exercised it: `start` was only ever
   * tested on the two paths that return early, and `stop` only when nothing had been
   * started. A stub binary is enough to prove the shape, and `Toolbar` takes the binary
   * as an argument, so no seam had to be invented to reach it.
   */
  const says = { info: () => {}, warn: () => {} };
  const said: string[] = [];
  const notes = {
    info: (line: string) => said.push(line),
    warn: (line: string) => said.push(line),
  };

  /**
   * A stand-in that behaves like the toolbar in the one way this cares about: it starts,
   * it stays up, and it goes when it is told to. It writes its own pid beside itself,
   * because that is the only thing here that knows it.
   */
  function aFakeToolbar(): string {
    const dir = mkdtempSync(join(tmpdir(), "colai-lifetime-"));
    const binary = join(dir, "colai-toolbar");
    writeFileSync(binary, '#!/bin/sh\necho $$ > "$0.pid"\nsleep 120\n');
    chmodSync(binary, 0o755);
    return binary;
  }

  /** The pid the stub wrote, once it has got as far as writing it. */
  async function itsPid(binary: string): Promise<number> {
    for (let tries = 0; tries < 200; tries += 1) {
      try {
        const pid = Number(readFileSync(`${binary}.pid`, "utf8").trim());
        if (pid) {
          return pid;
        }
      } catch {
        // Not yet.
      }
      await new Promise((soon) => setTimeout(soon, 10));
    }
    throw new Error("the stub toolbar never started");
  }

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test("stop does not return until the toolbar has actually gone", async () => {
    /*
     * The wait is the whole point. The toolbar holds a session-bus name until it exits,
     * so a restart that spawns before then hands its arguments to the dying copy, that
     * copy exits too, and nobody is left on screen — with "toolbar started" in the log.
     */
    const binary = aFakeToolbar();
    const toolbar = new Toolbar();
    toolbar.start(binary, join(mkdtempSync(join(tmpdir(), "colai-log-")), "t.log"), says);
    const pid = await itsPid(binary);
    expect(alive(pid), "it should be up").toBe(true);

    await toolbar.stop();
    expect(alive(pid), "stop returned while it was still running").toBe(false);
  });

  test("a toolbar already on screen is adopted, and the adopter can stop it", async () => {
    /*
     * A Gateway killed rather than stopped comes back to find its toolbar still running.
     * Spawning over it would hand the arguments to that copy and exit, leaving nothing
     * able to stop the toolbar somebody is looking at.
     *
     * A real executable, not the shell stub above: adoption reads `/proc/<pid>/exe`, and
     * a script's `exe` is the interpreter. `sleep` copied under the toolbar's name is the
     * smallest thing that answers that question the way the real binary does.
     */
    const dir = mkdtempSync(join(tmpdir(), "colai-adopt-"));
    const binary = join(dir, "colai-toolbar");
    copyFileSync("/bin/sleep", binary);
    const orphan = spawn(binary, ["120"], { detached: true, stdio: "ignore" });
    orphan.unref();
    await new Promise((soon) => setTimeout(soon, 150));
    expect(alive(orphan.pid!), "the orphan should be up").toBe(true);

    said.length = 0;
    const toolbar = new Toolbar();
    toolbar.start(binary, join(mkdtempSync(join(tmpdir(), "colai-log-")), "t.log"), notes);
    expect(said.join("\n")).toContain(`already running (pid ${orphan.pid})`);

    await toolbar.stop();
    await new Promise((soon) => setTimeout(soon, 150));
    expect(alive(orphan.pid!), "the adopter must be able to stop what it adopted").toBe(false);
  });
});
