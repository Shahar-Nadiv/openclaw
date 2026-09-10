// Build the toolbar and stage it for packing, and answer for it afterwards.
//
// The toolbar is a Tauri program, so somebody has to compile it. Not the installing
// machine: OpenClaw installs plugins with `--ignore-scripts`, always, with no flag and
// no config to opt in — `createSafeNpmInstallArgs` in `src/infra/safe-package-install.ts`
// puts it in every managed npm install. A `postinstall` here would never run, and asking
// somebody who wants a toolbar for a Rust toolchain and GTK headers was never a good
// trade anyway. So the toolbar travels already built, in `bin/`, and this is what puts
// it there before the package is packed.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const crate = join(root, "toolbar", "src-tauri");
const logFile = join(root, "build.log");
const compiled = join(crate, "target", "release", "colai-toolbar");
const staged = join(root, "bin", "colai-toolbar");

/** What building the toolbar needs, and the one command that provides it. */
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

const missing = whatIsMissing();

if (missing.length > 0) {
  console.error("\ncolai: the toolbar cannot be built here, because this machine is missing:\n");
  for (const need of missing) {
    console.error(`  · ${need.what}`);
    console.error(`    ${need.fix}\n`);
  }
  process.exit(1);
}

// Minutes, not seconds, and on a cold cache considerably more. Said before it starts,
// because a silent build that takes eleven minutes reads as a hang.
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
  // A log nobody can write is not a reason to fail a build that worked.
}

if (built.status !== 0) {
  console.error(`\ncolai: the toolbar failed to build after ${took}s.`);
  console.error(`The compiler's output is in ${logFile}\n`);
  process.exit(1);
}

// Staged rather than shipped from `target/`, so what the package carries is one named
// file and not a corner of a build directory.
mkdirSync(dirname(staged), { recursive: true });
copyFileSync(compiled, staged);
console.error(`colai: toolbar built in ${took}s and staged at bin/colai-toolbar.\n`);
