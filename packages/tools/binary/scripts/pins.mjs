// Writes the binary pins of a release (`binaries.json`, read by seampact/ir and seampact-ir) from its SHA256SUMS.
// Usage: node scripts/pins.mjs <version> <SHA256SUMS> <out-file>
import { readFileSync, writeFileSync } from "node:fs";
import {
  ReleasePinsError,
  releasePinsFromSha256Sums,
  releasePinsText,
} from "../src/release-pins.ts";
import { BINARY_FILE_NAMES } from "./binary-names.mjs";

const [version, manifestFile, outputFile, ...extraArguments] = process.argv.slice(2);

function fail(message) {
  console.error(`pins: ${message}`);
  process.exit(1);
}

if (
  version === undefined ||
  manifestFile === undefined ||
  outputFile === undefined ||
  extraArguments.length > 0
) {
  fail("usage: pins.mjs <version> <SHA256SUMS> <out-file>");
}

try {
  const text = releasePinsText(
    releasePinsFromSha256Sums(version, readFileSync(manifestFile, "utf8"), BINARY_FILE_NAMES),
  );

  writeFileSync(outputFile, text);
  process.stdout.write(text);
} catch (error) {
  if (!(error instanceof ReleasePinsError)) throw error;

  fail(`${error.message}. ${error.fix}`);
}
