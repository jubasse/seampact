// The SHA-256 manifest of the release binaries, in `sha256sum` format. Write it after the macOS binaries are
// re-signed: signing changes the file, and the hash must be that of the file a consumer downloads.
// Usage: node scripts/manifest.mjs write <bin-dir>   writes <bin-dir>/SHA256SUMS
//        node scripts/manifest.mjs check <bin-dir>   fails when a file differs from <bin-dir>/SHA256SUMS
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BINARY_FILE_NAMES, MANIFEST_FILE_NAME } from "./binary-names.mjs";

const [mode, directoryArgument] = process.argv.slice(2);
const directory = resolve(directoryArgument ?? "");

function fail(message) {
  console.error(`manifest: ${message}`);
  process.exit(1);
}

function hashOf(name) {
  return createHash("sha256")
    .update(readFileSync(join(directory, name)))
    .digest("hex");
}

function requireExactlyTheFiveBinaries() {
  const present = new Set(readdirSync(directory));
  const missing = BINARY_FILE_NAMES.filter((name) => !present.has(name));
  const unexpected = [...present].filter(
    (name) => !BINARY_FILE_NAMES.includes(name) && name !== MANIFEST_FILE_NAME,
  );

  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      `${directory} must hold the five binaries; missing: ${missing.join(", ") || "none"}, unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

function writeManifest() {
  requireExactlyTheFiveBinaries();

  const lines = BINARY_FILE_NAMES.map((name) => `${hashOf(name)}  ${name}`);

  writeFileSync(join(directory, MANIFEST_FILE_NAME), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

function checkManifest() {
  requireExactlyTheFiveBinaries();

  const written = readFileSync(join(directory, MANIFEST_FILE_NAME), "utf8");
  const expected = BINARY_FILE_NAMES.map((name) => `${hashOf(name)}  ${name}`).join("\n");

  if (written !== `${expected}\n`) fail(`a binary differs from ${MANIFEST_FILE_NAME}`);

  console.log(`manifest: the five binaries match ${MANIFEST_FILE_NAME}`);
}

if (mode === "write") writeManifest();
else if (mode === "check") checkManifest();
else fail("usage: manifest.mjs write|check <bin-dir>");
