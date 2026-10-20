import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLE_INTEGRITY_PREFIX } from "@seampact/spec/bundle";

// The bundle cache, by integrity value (ADR 0011 "Channels"): `SEAMPACT_CACHE_DIR`, else the OS user cache
// directory. An entry is written through a temporary directory and a rename, so a reader never sees half of one,
// and the pinned-bundle check runs again on every read: the cache is a copy, never a trust input.

export const CACHE_DIRECTORY_VARIABLE = "SEAMPACT_CACHE_DIR";

const CACHE_NAME = "seampact";
const BUNDLES_DIRECTORY = "bundles";
const TEMPORARY_PREFIX = ".incoming-";
const TEMPORARY_SUFFIX_BYTES = 8;
// A SHA-256 digest as `sha256-` and its padded standard base64.
const SHA256_INTEGRITY = /^sha256-[A-Za-z0-9+/]{43}=$/u;

type Environment = Readonly<Record<string, string | undefined>>;

/** The cache root for `env` on `platform`. */
export function bundleCacheDirectory(
  env: Environment,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const configured = nonEmpty(env[CACHE_DIRECTORY_VARIABLE]);

  if (configured !== undefined) return configured;

  if (platform === "win32")
    return join(nonEmpty(env.LOCALAPPDATA) ?? join(home, "AppData", "Local"), CACHE_NAME, "Cache");

  if (platform === "darwin") return join(home, "Library", "Caches", CACHE_NAME);

  return join(nonEmpty(env.XDG_CACHE_HOME) ?? join(home, ".cache"), CACHE_NAME);
}

// An empty variable counts as unset, as the XDG base directory rules say.
function nonEmpty(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

/** The entry directory of `integrity` under `cacheDirectory`, or undefined when the value is not a SHA-256 one. */
export function bundleCacheEntry(cacheDirectory: string, integrity: string): string | undefined {
  if (!SHA256_INTEGRITY.test(integrity)) return undefined;

  const digest = Buffer.from(integrity.slice(BUNDLE_INTEGRITY_PREFIX.length), "base64");

  return join(cacheDirectory, BUNDLES_DIRECTORY, `sha256-${digest.toString("hex")}`);
}

/** Copies the checked bundle at `directory` to `entry`; an entry another run wrote first is kept. */
export function storeBundleCacheEntry(directory: string, entry: string): void {
  if (existsSync(entry)) return;

  const parent = join(entry, "..");
  const incoming = join(
    parent,
    `${TEMPORARY_PREFIX}${randomBytes(TEMPORARY_SUFFIX_BYTES).toString("hex")}`,
  );

  mkdirSync(parent, { recursive: true });

  try {
    cpSync(directory, incoming, { recursive: true });
    renameSync(incoming, entry);
  } catch (error) {
    rmSync(incoming, { recursive: true, force: true });

    if (!existsSync(entry))
      throw new Error(
        `bundle: storing the cache entry '${entry}' failed: ${String(error)}. Check that ${CACHE_DIRECTORY_VARIABLE} or the user cache directory is writable.`,
      );
  }
}
