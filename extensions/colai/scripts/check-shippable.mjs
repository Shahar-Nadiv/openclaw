// Refuse to pack a toolbar that was built on the wrong machine.
//
// Two properties of the binary are decided by the machine that compiled it and by
// nothing in this repository: the oldest Linux it will run on, and whose home directory
// is embedded in it. A developer build on a current desktop gets both wrong — it once
// shipped with a GLIBC_2.39 floor, which is Ubuntu 24.04 and almost nothing else, and
// with the author's home directory inside it — and it gets them wrong silently. The
// tarball is the right size, the digest matches, the install succeeds, and the failure
// arrives on a stranger's machine as a window that never opens.
//
// So the build records where it happened, and this is the gate that reads it. Building
// locally stays exactly as easy as it was; only *publishing* one is refused.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provenance = join(root, "bin", "colai-toolbar.build.json");

/** The oldest glibc a published toolbar may demand. Jammy, which the release image is. */
const OLDEST_SUPPORTED = "2.35";

function older(left, right) {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);
  return leftMajor !== rightMajor ? leftMajor - rightMajor : leftMinor - rightMinor;
}

if (process.env.COLAI_ALLOW_DEV_BUILD === "1") {
  console.warn("colai: packing a developer build because COLAI_ALLOW_DEV_BUILD=1.");
  console.warn("colai: do not publish this tarball — it runs only on this machine's Linux.");
  process.exit(0);
}

if (!existsSync(provenance)) {
  console.error("colai: this toolbar was not built for release, so it will not be packed.");
  console.error("");
  console.error("A binary built here inherits this machine's glibc as the oldest Linux it");
  console.error("can run on, and carries this checkout's path inside it. Build it in the");
  console.error("release image instead:");
  console.error("");
  console.error("  npm run build:release");
  console.error("");
  console.error("To pack one for local testing anyway: COLAI_ALLOW_DEV_BUILD=1 npm pack");
  process.exit(1);
}

const built = JSON.parse(readFileSync(provenance, "utf8"));
if (older(built.glibc ?? "99.99", OLDEST_SUPPORTED) > 0) {
  console.error(`colai: this toolbar needs glibc ${built.glibc}, and may not need more`);
  console.error(`than ${OLDEST_SUPPORTED}. It would refuse to start on every Linux older`);
  console.error("than the one it was built on. Rebuild it: npm run build:release");
  process.exit(1);
}

console.log(
  `colai: shippable — built ${built.at} in ${built.image}, runs on glibc ${built.glibc} and newer.`,
);
