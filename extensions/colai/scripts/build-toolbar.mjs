// Build the toolbar after the plugin is installed, and answer for it afterwards.
//
// The toolbar is a Tauri program, so this compiles it here rather than shipping a binary.
// That asks for a Rust toolchain and GTK headers, which most people installing a plugin
// do not have — so the whole point of this script is that a machine without them is told
// exactly what is missing and what to run, instead of being handed a wall of compiler
// output.
//
// It never fails the install. A plugin that refuses to install leaves nothing behind to
// explain itself; one that installs and says the toolbar is not built yet can be fixed
// with `openclaw doctor` and a second attempt.
//
// `--check` reports the same findings as JSON and compiles nothing. The plugin's doctor
// check runs the script that way, so what the install decided and what the doctor says
// later can never disagree.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "..", "toolbar", "src-tauri");
const logFile = join(here, "..", "build.log");
const binary = join(crate, "target", "release", "colai-toolbar");

/** What the toolbar needs, and the one command that provides it. */
const NEEDS = [
  {
    what: "the Rust toolchain",
    probe: ["cargo", ["--version"]],
    fix: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  },
  {
    what: "GTK and WebKit development headers",
    probe: ["pkg-config", ["--exists", "webkit2gtk-4.1", "gtk+-3.0", "libsoup-3.0"]],
    fix: "sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev",
  },
];

function whatIsMissing() {
  return NEEDS.filter((need) => {
    const [command, args] = need.probe;
    try {
      // A missing command sets `error` rather than a status, so both count as a miss.
      return spawnSync(command, args, { encoding: "utf8" }).status !== 0;
    } catch {
      return true;
    }
  });
}

/**
 * Whether this copy is sitting inside the OpenClaw source tree rather than installed.
 *
 * Measured, not assumed: `pnpm install` in the fork runs every workspace project's
 * postinstall, so without this a routine dependency install would compile Rust for
 * several minutes for anybody working on OpenClaw itself. In a checkout the toolbar is
 * built by whoever is changing it, with `cargo build` — which is the same build, run
 * when it is wanted.
 */
function insideTheSourceTree() {
  try {
    const sibling = join(here, "..", "..", "..", "package.json");
    return JSON.parse(readFileSync(sibling, "utf8")).name === "openclaw";
  } catch {
    return false;
  }
}

const missing = whatIsMissing();

if (process.argv.includes("--check")) {
  console.log(
    JSON.stringify({
      built: existsSync(binary),
      missing: missing.map((need) => ({ what: need.what, fix: need.fix })),
      log: existsSync(logFile) ? logFile : null,
    }),
  );
  process.exit(0);
}

if (insideTheSourceTree()) {
  console.error("colai: an OpenClaw checkout, so the toolbar is left to `cargo build`.");
  process.exit(0);
}

if (missing.length > 0) {
  console.error("\ncolai: the toolbar was not built, because this machine is missing:\n");
  for (const need of missing) {
    console.error(`  · ${need.what}`);
    console.error(`    ${need.fix}\n`);
  }
  console.error("Install those and run `openclaw plugins update @colai/toolbar` to try again.");
  console.error("Everything else about the plugin is installed; only the toolbar is missing.\n");
  process.exit(0);
}

// Minutes, not seconds, and on a cold cache considerably more. Said before it starts,
// because a silent install that takes eleven minutes reads as a hang.
console.error("\ncolai: building the toolbar. This takes a few minutes the first time.\n");

const began = Date.now();
const built = spawnSync("cargo", ["build", "--release"], {
  cwd: crate,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const took = Math.round((Date.now() - began) / 1000);

try {
  writeFileSync(logFile, `${built.stdout ?? ""}\n${built.stderr ?? ""}`);
} catch {
  // A log nobody can write is not a reason to fail an install.
}

if (built.status === 0) {
  console.error(`colai: toolbar built in ${took}s. It will open with OpenClaw.\n`);
  process.exit(0);
}

// Everything it needs was there and it still failed, which is the case where the log is
// the only thing that helps.
console.error(`\ncolai: the toolbar failed to build after ${took}s.`);
console.error(`The compiler's output is in ${logFile}\n`);
process.exit(0);
