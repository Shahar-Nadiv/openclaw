import { getHealthCheck } from "openclaw/plugin-sdk/health";
// The plugin entry, loaded and registered the way the Gateway loads it.
//
// Everything else about colai is checked by reading files. This is the one test that
// runs `register`, because the failure it protects against — a plugin that installs,
// loads, and quietly registers nothing — leaves no other trace.
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it as test } from "vitest";
import colai from "./index.js";

type Service = { id: string; start: (ctx: unknown) => void; stop?: (ctx: unknown) => void };

/** Register the plugin against a host that records what it was handed. */
function registerColai(config: Record<string, unknown> = {}) {
  const services: Service[] = [];
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
    }),
  );
  return { services, said, ctx: { logger } };
}

describe("the plugin OpenClaw loads", () => {
  test("it registers one service and the doctor check for the toolbar", () => {
    const { services } = registerColai();
    expect(services.map((service) => service.id)).toEqual(["colai-toolbar"]);
    expect(getHealthCheck("colai/toolbar-built")?.kind).toBe("plugin");
  });

  test("registering twice does not fight the doctor registry", () => {
    // `register` runs again on reload, and a second claim on the same check id throws.
    expect(() => registerColai()).not.toThrow();
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

  test("stopping before anything started is not an error", () => {
    const { services, ctx } = registerColai({ autostart: false });
    expect(() => services[0]?.stop?.(ctx)).not.toThrow();
  });
});
