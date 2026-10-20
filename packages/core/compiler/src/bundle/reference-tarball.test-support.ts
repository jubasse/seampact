import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFsReader } from "../load/index.js";
import { buildBundle } from "./build.js";
import { bundleTarball } from "./tarball-write.js";

// Writes the reference contract's bundle tarball to the path given and prints its SHA-256: the
// `tarball is byte-reproducible` test runs it under another time zone, locale and umask, and the
// `bundle-determinism` CI job on Linux, macOS and Windows. Run it with
// node --experimental-transform-types --import ./scripts/ir-models/register.ts <this file> <tarball>

const REFERENCE = fileURLToPath(new URL("../../../../../fixtures/reference", import.meta.url));
const RESTRICTIVE_UMASK = 0o077;

export const REFERENCE_TARBALL_CONTRACT = {
  name: "@seampact-fixtures/reference",
  version: "1.0.0",
} as const;

/** The reference contract's bundle tarball, built from `directory` (the fixture by default). */
export function referenceTarball(directory: string = REFERENCE): Uint8Array {
  const built = buildBundle({
    reader: loadFsReader(directory),
    entry: "workspace.yaml",
    contract: REFERENCE_TARBALL_CONTRACT,
  });

  if (!built.ok)
    throw new Error(`the reference contract was not bundled: ${JSON.stringify(built.failures)}`);

  return bundleTarball(built.contents);
}

if (import.meta.main) {
  const output = process.argv[2];

  if (output === undefined)
    throw new Error("usage: reference-tarball.test-support.ts <tarball path>");

  process.umask(RESTRICTIVE_UMASK);
  const tarball = referenceTarball();

  writeFileSync(output, tarball);
  process.stdout.write(`${createHash("sha256").update(tarball).digest("hex")}\n`);
}
