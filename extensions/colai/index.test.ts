// The plugin entry, loaded and registered the way the Gateway loads it.
//
// Everything else about colai is checked by reading files. This is the one test that
// runs `register`, because the failure it protects against — a plugin that installs,
// loads, and quietly registers nothing — leaves no other trace.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it as test } from "vitest";
import colai from "./index.js";
import { notWhatWasBuilt } from "./src/digest.js";
import { toolbarOnScreen } from "./src/running.js";
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
   * The riskiest code in the plugin, and nothing exercised it before: `start` was only
   * ever tested on the paths that return early, and `stop` only when nothing had started.
   *
   * Both directions go through the toolbar's own front door now — running the binary
   * again hands the word to the copy already on screen. So a stub can play the toolbar by
   * doing the two things the real one does: write its pid where it was told, and remove
   * it when asked to go.
   */
  const quiet = { info: () => {}, warn: () => {} };
  const said: string[] = [];
  const notes = {
    info: (line: string) => said.push(line),
    warn: (line: string) => said.push(line),
  };

  /**
   * A stand-in that behaves like the toolbar in the ways this cares about: it records
   * where it is, it stays up, and `quit` reaches it and takes it away.
   */
  function aFakeToolbar(): { binary: string; pidfile: string } {
    const dir = mkdtempSync(join(tmpdir(), "colai-lifetime-"));
    const binary = join(dir, "colai-toolbar");
    writeFileSync(
      binary,
      [
        "#!/bin/sh",
        'pidfile=""',
        'word="show"',
        "while [ $# -gt 0 ]; do",
        '  case "$1" in',
        '    --pidfile) pidfile="$2"; shift 2 ;;',
        '    show|hide|toggle|quit) word="$1"; shift ;;',
        "    *) shift ;;",
        "  esac",
        "done",
        'up=""',
        'if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then',
        '  up="$(cat "$pidfile")"',
        "fi",
        // The single-instance handoff, which is the whole reason start and stop are the
        // same mechanism: a second copy hands its word to the first and exits.
        'if [ -n "$up" ]; then',
        '  [ "$word" = "quit" ] && kill "$up" 2>/dev/null',
        "  exit 0",
        "fi",
        // Nothing was up. `quit` has nothing to do; anything else becomes the toolbar.
        '[ "$word" = "quit" ] && exit 0',
        'echo $$ > "$pidfile"',
        `trap 'rm -f "$pidfile"; kill $sleeper 2>/dev/null; exit 0' TERM INT`,
        "sleep 120 &",
        "sleeper=$!",
        "wait $sleeper",
        `rm -f "$pidfile"`,
        "",
      ].join("\n"),
    );
    chmodSync(binary, 0o755);
    return { binary, pidfile: join(dir, "colai-toolbar.pid") };
  }

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const settle = (ms = 300) => new Promise((soon) => setTimeout(soon, ms));

  test("stop does not return until the toolbar has actually gone", async () => {
    /*
     * The wait is the point. The toolbar holds a single-instance lock until it exits, so
     * a restart that spawns before then hands its arguments to the dying copy, that copy
     * exits too, and nobody is left on screen — with "toolbar started" in the log.
     */
    const { binary, pidfile } = aFakeToolbar();
    const toolbar = new Toolbar(binary, pidfile);
    toolbar.start(join(mkdtempSync(join(tmpdir(), "colai-log-")), "t.log"), quiet);
    await settle();
    const pid = Number(readFileSync(pidfile, "utf8").trim());
    expect(alive(pid), "it should be up").toBe(true);

    await toolbar.stop();
    expect(alive(pid), "stop returned while it was still running").toBe(false);
  });

  test("a toolbar already up is told to show itself, not spawned over", async () => {
    /*
     * A Gateway killed rather than stopped comes back to find its toolbar still running.
     * Nothing has to recognise it: a second copy hands its word to the first and exits,
     * which is why the adoption logic that used to live here is gone.
     */
    const { binary, pidfile } = aFakeToolbar();
    const first = new Toolbar(binary, pidfile);
    first.start(join(mkdtempSync(join(tmpdir(), "colai-log-")), "t.log"), quiet);
    await settle();
    const pid = Number(readFileSync(pidfile, "utf8").trim());

    said.length = 0;
    const second = new Toolbar(binary, pidfile);
    second.start(join(mkdtempSync(join(tmpdir(), "colai-log-")), "t.log"), notes);
    expect(said.join("\n")).toContain(`already running (pid ${pid})`);

    await second.stop();
    expect(alive(pid), "and the second one can still stop it").toBe(false);
  });

  test("stopping when nothing is up is not an error", async () => {
    const { binary, pidfile } = aFakeToolbar();
    await expect(new Toolbar(binary, pidfile).stop()).resolves.toBeUndefined();
  });

  test("a pidfile left by a crash does not count as a toolbar", () => {
    // The file outlives a process that died without removing it, and the pid may since
    // have been given to somebody else — which matters, because this used to decide what
    // to stop.
    const dir = mkdtempSync(join(tmpdir(), "colai-stale-"));
    const pidfile = join(dir, "colai-toolbar.pid");
    // A pid nothing can be running under.
    writeFileSync(pidfile, "2147483646");
    expect(toolbarOnScreen(pidfile)).toBeNull();
    // And it is cleared, so the next look is a quick one.
    expect(existsSync(pidfile)).toBe(false);
  });
});
