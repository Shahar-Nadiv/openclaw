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

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { z } from "zod";

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
 * Where the toolbar is.
 *
 * `bin/` is the one that matters: OpenClaw installs plugins with `--ignore-scripts`,
 * always and with no way to opt in, so nothing a package says can make it compile on
 * the installing machine. The toolbar therefore travels already built, staged into
 * `bin/` before the package is packed.
 *
 * The two `target/` paths are for working on the toolbar itself, where `cargo build`
 * has just put one there and staging it first would only add a copy.
 */
function toolbarBinary(): string | null {
  const paths = [
    join(here, "bin/colai-toolbar"),
    join(here, "toolbar/src-tauri/target/release/colai-toolbar"),
    join(here, "toolbar/src-tauri/target/debug/colai-toolbar"),
  ];
  return paths.find((path) => existsSync(path)) ?? null;
}

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

    // `openclaw colai show|hide|toggle|status` — the whole control surface outside the
    // toolbar's own window, and the only one a plugin can offer without changing
    // OpenClaw. Anything can run a command: a terminal, a launcher, a shortcut.
    api.registerCli(
      async ({ program }) => {
        const { registerColaiCli } = await import("./src/cli.js");
        registerColaiCli(program, toolbarBinary);
      },
      {
        descriptors: [
          {
            name: "colai",
            description: "Show the colai toolbar, or put it away",
            hasSubcommands: true,
          },
        ],
      },
    );

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
