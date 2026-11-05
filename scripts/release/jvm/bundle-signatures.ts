// The signatures of a JVM staging bundle: publish-maven-central signs the unsigned bundle build-jvm checked, once the
// release is approved, with `gpg` in a throwaway home that holds the release key alone; the check verifies that each
// `.asc` is a good OpenPGP signature of the file beside it by that key. Before signing, a real run checks that the
// keyserver Central reads serves the release public key, so a key never sent fails first, not after the upload.
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

const PUBLIC_KEY_BLOCK = "-----BEGIN PGP PUBLIC KEY BLOCK-----";
const KEYSERVER_TIMEOUT_MILLISECONDS = 60_000;
const FINGERPRINT_RECORD = "fpr";
const FINGERPRINT_FIELD = 9;

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
    importSecretKey(home, key.secretKey);

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

/** Throws by name unless the keyserver serves the public key of the release key, which Central verifies against. */
export async function checkReleaseKeyOnKeyserver(
  secretKey: string,
  keyserver: string,
): Promise<void> {
  const fingerprint = releaseKeyFingerprint(secretKey);
  const query = new URLSearchParams({ op: "get", options: "mr", search: `0x${fingerprint}` });
  const url = `${keyserver.replace(/\/+$/, "")}/pks/lookup?${query}`;
  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(KEYSERVER_TIMEOUT_MILLISECONDS) });
  } catch (error) {
    throw new ReleaseError(
      `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}; nothing was signed`,
    );
  }

  if (response.ok && (await response.text()).includes(PUBLIC_KEY_BLOCK)) return;

  throw new ReleaseError(
    `${keyserver} does not serve the release public key ${fingerprint} (it answered ${response.status}), and Central verifies the signatures against it: ` +
      `send it with \`gpg --keyserver ${keyserver} --send-keys ${fingerprint}\`, then rerun; nothing was signed`,
  );
}

function releaseKeyFingerprint(secretKey: string): string {
  return withGpgHome((home) => {
    importSecretKey(home, secretKey);

    const listing = runGpg(
      home,
      ["--with-colons", "--list-secret-keys"],
      "the release key could not be listed",
    );
    const fingerprint = listing
      .split("\n")
      .find((record) => record.startsWith(`${FINGERPRINT_RECORD}:`))
      ?.split(":")[FINGERPRINT_FIELD];

    if (fingerprint === undefined || fingerprint === "")
      throw new ReleaseError("gpg lists no fingerprint for the release key");

    return fingerprint;
  });
}

function importSecretKey(home: string, secretKey: string): void {
  const secretKeyFile = join(home, "release-key.asc");

  writeFileSync(secretKeyFile, secretKey, { mode: 0o600 });
  runGpg(home, ["--import", secretKeyFile], "the release key could not be imported");
}

// Created owner-only, which gpg requires of its home. The agent gpg started there is stopped before the home goes.
function withGpgHome<T>(use: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "seampact-gpg-"));

  try {
    return use(home);
  } finally {
    stopGpgAgent(home);
    rmSync(home, { recursive: true, force: true });
  }
}

// Reported, not thrown: it runs in a finally, where a throw would hide the error that got there.
function stopGpgAgent(home: string): void {
  const result = spawnSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"], {
    encoding: "utf8",
  });

  if (result.error !== undefined || result.status !== 0)
    console.error(
      `the gpg-agent of ${home} could not be stopped (${result.error?.message ?? result.stderr.trim()}): it ends with the runner`,
    );
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
): string {
  const result = gpg(home, gpgArguments, input);

  if (result.error !== undefined)
    throw new ReleaseError(`gpg could not start (${result.error.message}): install GnuPG`);

  if (result.status !== 0) throw new ReleaseError(`${failure}: ${result.stderr.trim()}`);

  return result.stdout;
}

function gpg(home: string, gpgArguments: readonly string[], input?: string) {
  return spawnSync("gpg", ["--homedir", home, "--batch", "--quiet", ...gpgArguments], {
    encoding: "utf8",
    env: { ...process.env, GNUPGHOME: home },
    input,
  });
}
