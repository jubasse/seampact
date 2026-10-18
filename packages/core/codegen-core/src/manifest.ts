import { join } from "node:path";
import { compareCodeUnits } from "./code-unit-order.js";
import { readFileIfPresent } from "./file-presence.js";
import { MANIFEST_FILE_NAME, unsafePathReason } from "./generated-paths.js";

// What the writer keeps in a target's output directory (ADR 0015 "Writing files"): the target that owns the
// directory, and each file it generated with the SHA-256 of its bytes, in code-unit order of path.
export interface ManifestEntry {
  path: string;
  sha256: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ManifestRead =
  | { status: "read"; owner: string | undefined; hashByPath: ReadonlyMap<string, string> }
  | { status: "invalid"; reason: string };

// Reads the manifest of `rootDir`; a missing one is an empty manifest without an owner (a first run). Every entry is checked like a
// generated path, so a tampered manifest cannot make the writer delete outside its directory.
export async function readManifest(rootDir: string): Promise<ManifestRead> {
  const text = await readFileIfPresent(join(rootDir, MANIFEST_FILE_NAME));

  if (text === undefined) return { status: "read", owner: undefined, hashByPath: new Map() };

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      status: "invalid",
      reason: `it is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  return entriesOf(parsed);
}

export function serializeManifest(owner: string, hashByPath: ReadonlyMap<string, string>): string {
  const files: ManifestEntry[] = [...hashByPath]
    .map(([path, sha256]) => ({ path, sha256 }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));

  return `${JSON.stringify({ owner, files }, null, 2)}\n`;
}

function entriesOf(parsed: unknown): ManifestRead {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("files" in parsed) ||
    !Array.isArray(parsed.files)
  ) {
    return { status: "invalid", reason: "it has no `files` array" };
  }

  if (!("owner" in parsed) || typeof parsed.owner !== "string") {
    return { status: "invalid", reason: "it has no `owner` target id" };
  }

  const hashByPath = new Map<string, string>();

  for (const entry of parsed.files) {
    const reason = invalidEntryReason(entry, hashByPath);

    if (reason !== undefined) return { status: "invalid", reason };

    hashByPath.set(entry.path, entry.sha256);
  }

  return { status: "read", owner: parsed.owner, hashByPath };
}

function invalidEntryReason(entry: unknown, seen: ReadonlyMap<string, string>): string | undefined {
  if (!isEntryShape(entry)) return "an entry is not `{ path, sha256 }` strings";

  if (!SHA256_HEX.test(entry.sha256))
    return `the hash of '${entry.path}' is not a SHA-256 hex digest`;

  if (seen.has(entry.path)) return `'${entry.path}' is listed twice`;

  const unsafe = unsafePathReason(entry.path);

  return unsafe === undefined ? undefined : `the path '${entry.path}' is unsafe: ${unsafe}`;
}

function isEntryShape(entry: unknown): entry is ManifestEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "path" in entry &&
    typeof entry.path === "string" &&
    "sha256" in entry &&
    typeof entry.sha256 === "string"
  );
}
