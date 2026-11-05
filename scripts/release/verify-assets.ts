// The check of the release assets before any upload: `SHA256SUMS` is the manifest the binary call hashed (and, in a
// real run, attested), each file it lists has its hash, and the directory holds no file it does not list.
//   node scripts/release/verify-assets.ts <assets-dir> --sums-sha256 <hex>
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsedArguments, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError } from "./release-version.ts";

export const MANIFEST_NAME = "SHA256SUMS";

const MANIFEST_LINE = /^([0-9a-f]{64}) {2}(\S+)$/;

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Throws a `ReleaseError` naming each asset that does not match; answers the asset names otherwise. */
export function verifiedAssets(directory: string, manifestSha256: string): string[] {
  const manifest = join(directory, MANIFEST_NAME);

  if (!existsSync(manifest)) throw new ReleaseError(`${directory} holds no ${MANIFEST_NAME}`);

  const actualManifestSha256 = sha256Of(manifest);

  if (actualManifestSha256 !== manifestSha256)
    throw new ReleaseError(
      `${MANIFEST_NAME} hashes ${actualManifestSha256}, but the binary call output ${manifestSha256 || "nothing"}: ` +
        "these are not the assets the call hashed, so nothing is uploaded",
    );

  const expectedByName = manifestEntries(readFileSync(manifest, "utf8"));
  const problems: string[] = [];

  for (const [name, expected] of expectedByName) {
    const file = join(directory, name);

    if (!existsSync(file)) problems.push(`${name} is listed in ${MANIFEST_NAME} but missing`);
    else if (sha256Of(file) !== expected)
      problems.push(`${name} does not have the hash ${MANIFEST_NAME} lists`);
  }

  for (const name of readdirSync(directory).sort())
    if (name !== MANIFEST_NAME && !expectedByName.has(name))
      problems.push(`${name} is not listed in ${MANIFEST_NAME}`);

  if (problems.length > 0) throw new ReleaseError(problems.join("; "));

  return [...expectedByName.keys()];
}

function manifestEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of text.split("\n").filter((candidate) => candidate !== "")) {
    const entry = MANIFEST_LINE.exec(line);

    if (entry === null || entry[1] === undefined || entry[2] === undefined)
      throw new ReleaseError(`${MANIFEST_NAME} line "${line}" is not \`<sha256>  <asset>\``);

    entries.set(entry[2], entry[1]);
  }

  return entries;
}

if (import.meta.main)
  await runReleaseCommand("verify-assets", () => {
    const usage = "node scripts/release/verify-assets.ts <assets-dir> --sums-sha256 <hex>";
    const { values, positionals } = parsedArguments({ "sums-sha256": { type: "string" } }, usage);
    const directory = positionals[0];

    if (directory === undefined || values["sums-sha256"] === undefined)
      throw new ReleaseError(
        `the assets directory and --sums-sha256 are required; usage: ${usage}`,
      );

    const names = verifiedAssets(directory, values["sums-sha256"]);

    console.log(
      `verify-assets: ${names.length} asset(s) match ${MANIFEST_NAME}: ${names.join(", ")}`,
    );
  });
