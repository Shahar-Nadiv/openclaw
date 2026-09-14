// Export this plugin as the standalone repository ClawHub reviews.
//
// ClawHub asks for a public repository so somebody can read the source before they install
// a program that draws over their desktop and photographs it. This plugin is developed
// inside a fork of the whole OpenClaw monorepo, and pointing a reviewer at that would hand
// them a hundred thousand lines that are not this plugin, plus every unrelated commit its
// author ever made to the fork.
//
// So the published source is its own repository, and this is what produces it. Written as
// a script rather than done by hand because two copies of anything drift, and a drift
// between "the source people reviewed" and "the source that was published" is the one
// drift that matters here.
//
//   node scripts/export-repo.mjs [--to <dir>]
//
// What it copies is exactly `git ls-files`, so anything untracked — `bin/`, `dist/`,
// `node_modules/`, a build tree — cannot leak into a public repository by being present in
// the working directory. What it then changes is the three things that only make sense
// inside the monorepo, listed below.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..");

const asked = process.argv.indexOf("--to");
const out = resolve(
  asked === -1 ? `${process.env.HOME}/Desktop/colai-clawhub` : process.argv[asked + 1],
);

/** The published repository, which the manifest has to agree with. */
const REPO = "https://github.com/Shahar-Nadiv/colai-clawhub";

/**
 * Versions the monorepo supplies by being a monorepo.
 *
 * `workspace:*` is a pnpm spelling that means nothing outside a workspace, and the imports
 * are `openclaw/plugin-sdk/*` subpaths — so the package that provides them is `openclaw`
 * itself, pinned to the oldest host this plugin claims to work with.
 */
const DEV = {
  esbuild: "0.28.2",
  openclaw: "2026.9.1",
  vitest: "4.1.11",
};

function tracked() {
  const listed = spawnSync("git", ["ls-files"], { cwd: plugin, encoding: "utf8" });
  if (listed.status !== 0) {
    console.error("colai: could not list the tracked files.");
    process.exit(1);
  }
  return listed.stdout.split("\n").filter(Boolean);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// This script is the monorepo's tool for producing the export; it has no meaning inside
// one, and a copy of it in the public tree would invite somebody to run it there.
const files = tracked().filter((file) => file !== "scripts/export-repo.mjs");
for (const file of files) {
  const to = join(out, file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(plugin, file), to);
}

// ── 1. the manifest ──────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
manifest.devDependencies = DEV;
manifest.scripts = {
  build: "node scripts/build-runtime.mjs && node scripts/build-toolbar.mjs",
  ship: "node scripts/ship.mjs",
  prepack: "node scripts/check-shippable.mjs && node scripts/build-runtime.mjs",
  test: "vitest run",
  "build:runtime": "node scripts/build-runtime.mjs",
  "build:toolbar": "node scripts/build-toolbar.mjs",
  "build:release": "node scripts/build-release.mjs",
};
manifest.repository = { type: "git", url: `git+${REPO}.git` };
manifest.homepage = `${REPO}#readme`;
manifest.bugs = { url: `${REPO}/issues` };
writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// ── 2. the fresh-install harness ─────────────────────────────────────────────
//
// It built the runtime by reaching up to a monorepo script. Standalone, the package's own
// builder is right there.
const harness = join(out, "test/fresh-install.sh");
const was = readFileSync(harness, "utf8");
const reached = `repo="$(cd "$plugin/../.." && pwd)"
echo "building the plugin runtime"
(cd "$repo" && node --import ./scripts/tsx.mjs scripts/check-plugin-npm-runtime-builds.mts \\
  --package extensions/colai)
`;
if (!was.includes(reached)) {
  console.error("colai: the fresh-install harness no longer builds the runtime the way this");
  console.error("expects, so the export would silently ship a broken one. Update this script.");
  process.exit(1);
}
writeFileSync(
  harness,
  was.replace(
    reached,
    'echo "building the plugin runtime"\n(cd "$plugin" && node scripts/build-runtime.mjs)\n',
  ),
);

// ── 3. what a standalone checkout needs and a subtree does not ───────────────
writeFileSync(
  join(out, ".gitignore"),
  `# Build output. The binary is 13 MB and is rebuilt from \`release/Dockerfile\`; what a
# reviewer needs is the source it was built from, and what a user needs is the npm
# tarball, which carries it.
bin/
dist/
node_modules/
toolbar/src-tauri/target/
`,
);

writeFileSync(
  join(out, "vitest.config.ts"),
  `// The suite runs from this package rather than from the monorepo it was cut out of.
//
// \`index.test.ts\` spawns the real binary and \`toolbar.test.ts\` reads two source files off
// disk, so neither wants a browser environment.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    environment: "node",
  },
});
`,
);

console.log(`colai: exported ${files.length} tracked files to ${out}`);
console.log("colai: next — npm install --legacy-peer-deps && npx vitest run");
