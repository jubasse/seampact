// The binary pins a release writes into the PHP and Python packages (`binaries.json`, ADR 0010 "Pin"): the
// compiler version and one SHA-256 per release asset, read from the release `SHA256SUMS`. The monorepo keeps the
// empty pin; only release artefacts carry a filled one. No relative import, so `scripts/pins.mjs` runs it on Node.

export interface ReleasePins {
  readonly version: string;
  readonly sha256: Readonly<Record<string, string>>;
}

export class ReleasePinsError extends Error {
  override readonly name = "ReleasePinsError";
}

// A release version: semver, a pre-release and build metadata allowed.
const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
// A `sha256sum` line in text mode: the lowercase hash, two spaces, the file name.
const MANIFEST_LINE_PATTERN = /^([0-9a-f]{64}) {2}(\S+)$/;
const JSON_INDENT = 2;

// The pins of `version` from the text of `SHA256SUMS`, which must list each of `assetNames` once and nothing else.
export function releasePinsFromSha256Sums(
  version: string,
  sha256SumsText: string,
  assetNames: readonly string[],
): ReleasePins {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new ReleasePinsError(
      `'${version}' is no release version (semver, such as 1.0.0 or 1.0.0-rc.1)`,
    );
  }

  const hashByAsset = hashesOfManifest(sha256SumsText, assetNames);
  // In the order of `assetNames`, so the written file does not depend on the manifest's line order.
  const sha256: Record<string, string> = {};
  const missingAssets: string[] = [];

  for (const asset of assetNames) {
    const hash = hashByAsset.get(asset);

    if (hash === undefined) missingAssets.push(asset);
    else sha256[asset] = hash;
  }

  if (missingAssets.length > 0) {
    throw new ReleasePinsError(`SHA256SUMS lists no hash for ${missingAssets.join(", ")}`);
  }

  return { version, sha256 };
}

function hashesOfManifest(
  sha256SumsText: string,
  assetNames: readonly string[],
): Map<string, string> {
  const hashByAsset = new Map<string, string>();
  const lines = sha256SumsText.endsWith("\n")
    ? sha256SumsText.slice(0, -1).split("\n")
    : sha256SumsText.split("\n");

  for (const [index, line] of lines.entries()) {
    const [, hash, asset] = MANIFEST_LINE_PATTERN.exec(line) ?? [];

    if (hash === undefined || asset === undefined) {
      throw new ReleasePinsError(
        `SHA256SUMS line ${index + 1} is not '<64 lowercase hex digits>  <file name>'`,
      );
    }

    if (!assetNames.includes(asset)) {
      throw new ReleasePinsError(
        `SHA256SUMS lists '${asset}', which is no release binary (${assetNames.join(", ")})`,
      );
    }

    if (hashByAsset.has(asset)) throw new ReleasePinsError(`SHA256SUMS lists '${asset}' twice`);

    hashByAsset.set(asset, hash);
  }

  return hashByAsset;
}

// The `binaries.json` text the PHP and Python readers take: the layout of the empty pin, one asset per line.
export function releasePinsText(pins: ReleasePins): string {
  return `${JSON.stringify({ version: pins.version, sha256: pins.sha256 }, null, JSON_INDENT)}\n`;
}
