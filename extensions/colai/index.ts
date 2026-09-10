// colai: point at anything on screen and hand it to an agent.
//
// The toolbar is a desktop program — an X11 overlay that shapes itself, photographs what
// is behind it and reads which window is in front. None of that can live inside a Node
// plugin or a Control UI page, so this plugin does not contain the toolbar: it builds it
// on install and runs it while OpenClaw is running.
//
// Nothing here asks anybody to configure a Gateway. The toolbar finds one by asking the
// `openclaw` CLI — the same CLI that installed this plugin — and that call installs and
// starts the service if it is not up yet. Somebody who runs `openclaw plugins install`
// should get a toolbar, not a form.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  getHealthCheck,
  registerHealthCheck,
  type HealthFinding,
} from "openclaw/plugin-sdk/health";
import { buildPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { z } from "zod";

const runFile = promisify(execFile);

/**
 * The package root, whichever file is running.
 *
 * In a checkout this module IS `index.ts` at the root; installed from npm it is
 * `dist/index.js`, one level down. Everything below is addressed from the package —
 * the toolbar's sources, the build script — so a `here` that means two different
 * places depending on how the plugin was obtained is a plugin that works in
 * development and points at nothing on anybody else's machine.
 */
function packageRoot(): string {
  let at = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(at, "package.json"))) {
    const up = dirname(at);
    if (up === at) {
      throw new Error("colai: could not find the plugin package root");
    }
    at = up;
  }
  return at;
}

const here = packageRoot();

const ColaiConfigSchema = z.strictObject({
  /**
   * Whether the toolbar appears when OpenClaw does.
   *
   * On, because that is what it is for: a toolbar nobody can see is a toolbar nobody
   * uses, and it is how this behaved when it lived inside the desktop app. Off leaves it
   * installed and built, waiting to be started by hand.
   */
  autostart: z.boolean().optional(),
});

const configSchema = buildPluginConfigSchema(ColaiConfigSchema);

/**
 * Where the built toolbar ended up.
 *
 * Release first, because that is what the install builds. The debug path is here for
 * working on the toolbar itself, where `cargo build` has already put one there and
 * rebuilding it as release would double the wait for no gain.
 */
function toolbarBinary(): string | null {
  for (const profile of ["release", "debug"]) {
    const path = join(here, "toolbar/src-tauri/target", profile, "colai-toolbar");
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

const BUILD_CHECK_ID = "colai/toolbar-built";

/**
 * What `openclaw doctor` says about the toolbar.
 *
 * It asks the install script rather than probing again, so the answer here and the one
 * printed during install come from the same list and cannot drift apart.
 */
const toolbarBuildCheck = {
  id: BUILD_CHECK_ID,
  kind: "plugin",
  description: "Check that the colai toolbar is built and can be built.",
  source: "colai",
  async detect(): Promise<readonly HealthFinding[]> {
    let report: { built: boolean; missing: { what: string; fix: string }[]; log: string | null };
    try {
      const { stdout } = await runFile(
        process.execPath,
        [join(here, "scripts/build-toolbar.mjs"), "--check"],
        { encoding: "utf8" },
      );
      report = JSON.parse(stdout);
    } catch (error) {
      return [
        {
          checkId: BUILD_CHECK_ID,
          severity: "error",
          source: "colai",
          message: `colai could not check the toolbar: ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }

    // Built and running is the whole answer, even on a machine that has since lost the
    // toolchain — nothing needs rebuilding until the plugin is updated.
    if (report.built) {
      return [];
    }

    if (report.missing.length > 0) {
      return report.missing.map((need) => ({
        checkId: BUILD_CHECK_ID,
        severity: "warning" as const,
        source: "colai",
        message: `The colai toolbar cannot be built: this machine is missing ${need.what}.`,
        requirement: need.what,
        fixHint: `${need.fix}\nThen run \`openclaw plugins update @colai/toolbar\`.`,
      }));
    }

    // Everything it needs is here and it still is not built, so the build is the thing
    // that failed and its log is what explains it.
    return [
      {
        checkId: BUILD_CHECK_ID,
        severity: "warning",
        source: "colai",
        message: "The colai toolbar is not built, although this machine has everything it needs.",
        path: report.log ?? undefined,
        fixHint: report.log
          ? `Read ${report.log}, then run \`openclaw plugins update @colai/toolbar\`.`
          : "Run `openclaw plugins update @colai/toolbar`.",
      },
    ];
  },
} as const;

export default definePluginEntry({
  id: "colai",
  name: "colai",
  description: "Point at anything on screen and hand it to an agent.",
  configSchema,
  register(api) {
    const parsed = ColaiConfigSchema.safeParse(api.pluginConfig ?? {});
    if (!parsed.success) {
      throw new Error(
        `Invalid colai plugin config: ${parsed.error.issues[0]?.message ?? "invalid config"}`,
      );
    }
    const autostart = parsed.data.autostart ?? true;

    // Registering the same id twice throws, and `register` runs again whenever the
    // plugin is reloaded.
    if (!getHealthCheck(BUILD_CHECK_ID)) {
      registerHealthCheck(toolbarBuildCheck);
    }

    let toolbar: ChildProcess | null = null;

    api.registerService({
      id: "colai-toolbar",
      // Turning autostart off should put the toolbar away, not wait for a restart.
      reload: { configPrefixes: ["plugins.entries.colai.config.autostart"] },
      start(ctx) {
        if (!autostart) {
          ctx.logger.info("colai: autostart is off, so the toolbar is not being started.");
          return;
        }
        // The overlay is X11. Said rather than left to fail inside a window system that
        // is not there — a plugin that dies on a headless host should say why.
        if (!process.env.DISPLAY) {
          ctx.logger.warn(
            "colai: no DISPLAY, so there is no screen to draw on. The toolbar is not being started.",
          );
          return;
        }
        const binary = toolbarBinary();
        if (!binary) {
          ctx.logger.warn(
            "colai: the toolbar has not been built. Run `openclaw doctor` to see what is missing.",
          );
          return;
        }
        // Detached and unwatched: this is a window somebody looks at for hours, not a
        // worker, and its output belongs in its own log rather than the Gateway's.
        toolbar = spawn(binary, [], { detached: true, stdio: "ignore" });
        toolbar.unref();
        toolbar.once("exit", (code, signal) => {
          // Only worth a line when it was not asked to go.
          if (signal !== "SIGTERM") {
            ctx.logger.warn(`colai: the toolbar exited (${signal ?? code}).`);
          }
          toolbar = null;
        });
        ctx.logger.info("colai: toolbar started.");
      },
      stop() {
        // The toolbar is detached, so it outlives this process unless it is told not to.
        if (toolbar?.pid) {
          try {
            process.kill(toolbar.pid, "SIGTERM");
          } catch {
            // Already gone, which is the outcome this wanted.
          }
        }
        toolbar = null;
      },
    });
  },
});
