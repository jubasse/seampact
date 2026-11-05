// The signatures of a JVM staging bundle: publish-maven-central signs the unsigned bundle build-jvm checked, once the
// release is approved, with `gpg` in a throwaway home that holds the release key alone; the check verifies that each
// `.asc` is a good OpenPGP signature of the file beside it by that key.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseError } from "../release-version.ts";
import { isDerivedFile, SIGNATURE_SUFFIX } from "./bundle-layout.ts";
import {
  type BundleManifestEntry,
  bundleManifest,
  checkBundleAgainstManifest,
} from "./bundle-manifest.ts";

/** The release key: its ASCII-armoured secret key and its passphrase, empty for a key without one. */
export interface SigningKey {
  readonly secretKey: string;
  readonly passphrase: string;
}

/** The signatures of the files that fail to verify with the key; `keyFile` holds the armoured public or secret key. */
export function bundleSignatureProblems(
  directory: string,
  files: readonly string[],
  keyFile: string,
): string[] {
  return withGpgHome((home) => {
    runGpg(home, ["--import", keyFile], `the key ${keyFile} could not be imported`);

    return signatureProblems(home, directory, files);
  });
}

/**
 * Signs every file of the unsigned bundle that is no digest, after checking the bundle is exactly the manifest's,
 * then verifies each new signature; returns the manifest of the signed bundle, the `.asc` files included.
 */
export function signBundle(
  directory: string,
  manifest: readonly BundleManifestEntry[],
  key: SigningKey,
): BundleManifestEntry[] {
  const signedAlready = manifest.filter((entry) => entry.path.endsWith(SIGNATURE_SUFFIX));

  if (signedAlready.length > 0)
    throw new ReleaseError(
      `the manifest lists signatures (${signedAlready[0]?.path}): build-jvm stages unsigned bundles, signed once only`,
    );

  checkBundleAgainstManifest(directory, manifest);

  return withGpgHome((home) => {
    const secretKeyFile = join(home, "release-key.asc");

    writeFileSync(secretKeyFile, key.secretKey, { mode: 0o600 });
    runGpg(home, ["--import", secretKeyFile], "the release key could not be imported");

    const signedFiles = manifest.map((entry) => entry.path).filter((path) => !isDerivedFile(path));

    for (const path of signedFiles) {
      const file = join(directory, path);

      runGpg(
        home,
        [
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "0",
          "--armor",
          "--detach-sign",
          "--output",
          `${file}${SIGNATURE_SUFFIX}`,
          file,
        ],
        `${path} could not be signed`,
        key.passphrase,
      );
    }

    const signatures = signedFiles.map((path) => `${path}${SIGNATURE_SUFFIX}`);
    const problems = signatureProblems(home, directory, signatures);

    if (problems.length > 0)
      throw new ReleaseError(`the new signatures do not verify:\n  ${problems.join("\n  ")}`);

    return bundleManifest(directory);
  });
}

// Created owner-only, which gpg requires of its home.
function withGpgHome<T>(use: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "seampact-gpg-"));

  try {
    return use(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function signatureProblems(home: string, directory: string, files: readonly string[]): string[] {
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
}

function verifies(home: string, signature: string, file: string): boolean {
  return gpg(home, ["--verify", signature, file]).status === 0;
}

function runGpg(
  home: string,
  gpgArguments: readonly string[],
  failure: string,
  input?: string,
): void {
  const result = gpg(home, gpgArguments, input);

  if (result.error !== undefined)
    throw new ReleaseError(`gpg could not start (${result.error.message}): install GnuPG`);

  if (result.status !== 0) throw new ReleaseError(`${failure}: ${result.stderr.trim()}`);
}

function gpg(home: string, gpgArguments: readonly string[], input?: string) {
  return spawnSync("gpg", ["--homedir", home, "--batch", "--quiet", ...gpgArguments], {
    encoding: "utf8",
    env: { ...process.env, GNUPGHOME: home },
    input,
  });
}
