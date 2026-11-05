// The signature check of a JVM staging bundle: each `.asc` is a good OpenPGP signature of the file beside it by
// the release key, verified by `gpg` in a throwaway home that holds that key alone.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseError } from "../release-version.ts";

const SIGNATURE_SUFFIX = ".asc";

/** The signatures of the files that fail to verify with the key; `keyFile` holds the armoured public or secret key. */
export function bundleSignatureProblems(
  directory: string,
  files: readonly string[],
  keyFile: string,
): string[] {
  // Created owner-only, which gpg requires of its home.
  const home = mkdtempSync(join(tmpdir(), "seampact-gpg-"));

  try {
    runGpg(home, ["--import", keyFile], `the key ${keyFile} could not be imported`);

    return files
      .filter((path) => path.endsWith(SIGNATURE_SUFFIX))
      .filter(
        (signature) =>
          !verifies(
            home,
            join(directory, signature),
            join(directory, signature.slice(0, -SIGNATURE_SUFFIX.length)),
          ),
      )
      .map((signature) => `${signature} is no good signature of its file by the release key`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function verifies(home: string, signature: string, file: string): boolean {
  return gpg(home, ["--verify", signature, file]).status === 0;
}

function runGpg(home: string, gpgArguments: readonly string[], failure: string): void {
  const result = gpg(home, gpgArguments);

  if (result.error !== undefined)
    throw new ReleaseError(`gpg could not start (${result.error.message}): install GnuPG`);

  if (result.status !== 0) throw new ReleaseError(`${failure}: ${result.stderr.trim()}`);
}

function gpg(home: string, gpgArguments: readonly string[]) {
  return spawnSync("gpg", ["--homedir", home, "--batch", "--quiet", ...gpgArguments], {
    encoding: "utf8",
    env: { ...process.env, GNUPGHOME: home },
  });
}
