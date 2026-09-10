// Is the binary about to run the one that was built?
//
// Its own module because it is the one security decision this plugin makes on its own,
// and it should be readable and testable without a running Gateway.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Whether the binary about to be spawned is the one that was built.
 *
 * The package ships a native program that runs as the user, photographs the screen and
 * authenticates to the Gateway. npm proves nothing about what is inside a tarball, so the
 * build writes a digest beside the binary and this checks it before anything runs.
 *
 * It is not a signature: whoever can replace the binary can replace the digest next to
 * it. What it closes is the narrower and likelier case — an artifact tampered with in
 * transit or on disk — and it turns a silent substitution into a refusal.
 *
 * No digest means a developer build, straight out of `target/`. Those are not staged and
 * have nothing to compare against; refusing them would mean refusing to run the thing
 * somebody just compiled.
 */
export function notWhatWasBuilt(binary: string): string | null {
  const beside = `${binary}.sha256`;
  if (!existsSync(beside)) {
    return null;
  }
  let expected: string;
  let actual: string;
  try {
    expected = readFileSync(beside, "utf8").trim();
    actual = createHash("sha256").update(readFileSync(binary)).digest("hex");
  } catch (error) {
    return `could not check the toolbar against its digest: ${String(error)}`;
  }
  if (expected !== actual) {
    return (
      `the toolbar does not match the digest shipped beside it, so it was not started. ` +
      `Expected ${expected}, found ${actual}. Reinstall the plugin.`
    );
  }
  return null;
}
