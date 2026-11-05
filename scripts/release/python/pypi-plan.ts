// The idempotent side of the PyPI publish: exactly the distributions of build-python's manifest, checked against it,
// then each file the index already holds with the same SHA-256 is skipped, and every other one is copied to the
// upload directory the publish action reads. A file the index holds with other bytes, or a file of the version the
// run did not build, fails by name before anything is uploaded, since a published file never changes.
//   node scripts/release/python/pypi-plan.ts <dist-dir> --manifest <file> --version <version> --index <url>
//     --out <upload-dir> [--root <dir>]
// `--index` is the base of the PyPI JSON API (`<index>/pypi/<name>/<version>/json`): https://pypi.org, or the
// rehearsal's local index.
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isJsonRecord } from "../json-record.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import {
  type DistributionManifestEntry,
  manifestDistributions,
  parsedDistributionManifest,
  releaseDistributionNames,
} from "./dist-manifest.ts";

const HTTP_NOT_FOUND = 404;
// An index that does not answer within this time fails the job instead of holding it to its timeout.
const INDEX_TIMEOUT_MILLISECONDS = 30_000;

export interface UploadPlan {
  readonly toUpload: readonly DistributionManifestEntry[];
  readonly alreadyPublished: readonly DistributionManifestEntry[];
}

/** Asks the index for each release; throws a `ReleaseError` naming every file held with other bytes. */
export async function uploadPlan(
  index: string,
  distributions: readonly DistributionManifestEntry[],
): Promise<UploadPlan> {
  const toUpload: DistributionManifestEntry[] = [];
  const alreadyPublished: DistributionManifestEntry[] = [];
  const conflicts: string[] = [];

  for (const name of [...new Set(distributions.map((entry) => entry.name))]) {
    const files = distributions.filter((entry) => entry.name === name);
    const version = files[0]?.version ?? "";
    const published = await publishedFiles(index, name, version);

    for (const entry of files) {
      const sha256 = published.get(entry.file);

      if (sha256 === undefined) toUpload.push(entry);
      else if (sha256 === entry.sha256) alreadyPublished.push(entry);
      else
        conflicts.push(
          `${entry.file} is on ${index} with other bytes (${sha256}, this file is ${entry.sha256})`,
        );
    }

    for (const file of published.keys())
      if (!files.some((entry) => entry.file === file))
        conflicts.push(
          `${name} ${version} on ${index} holds ${file}, which this run did not build`,
        );
  }

  if (conflicts.length > 0)
    throw new ReleaseError(
      `${conflicts.join("; ")}: a published file never changes, so nothing was uploaded; stamp and release a new ` +
        "patch version",
    );

  return { toUpload, alreadyPublished };
}

// The file names and SHA-256 of the release on the index; empty when the index has no such release.
async function publishedFiles(
  index: string,
  name: string,
  version: string,
): Promise<Map<string, string>> {
  const url = `${index.replace(/\/+$/, "")}/pypi/${name}/${version}/json`;
  const response = await fetchRelease(url, name);

  if (response.status === HTTP_NOT_FOUND) return new Map();

  if (!response.ok)
    throw new ReleaseError(
      `${url} answered ${response.status}: the index cannot say whether ${name} is published`,
    );

  const release: unknown = await response.json();
  const urls = isJsonRecord(release) ? release.urls : undefined;

  if (!Array.isArray(urls))
    throw new ReleaseError(`${url} has no \`urls\` list of the release's files`);

  return new Map(urls.map((file: unknown) => releaseFile(file, url)));
}

function releaseFile(file: unknown, url: string): [string, string] {
  const filename = isJsonRecord(file) ? file.filename : undefined;
  const digests = isJsonRecord(file) ? file.digests : undefined;
  const sha256 = isJsonRecord(digests) ? digests.sha256 : undefined;

  if (typeof filename !== "string" || typeof sha256 !== "string")
    throw new ReleaseError(`${url} lists a file without a \`filename\` and a \`digests.sha256\``);

  return [filename, sha256];
}

async function fetchRelease(url: string, name: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    throw new ReleaseError(
      `${url} did not answer (${error instanceof Error ? error.message : String(error)}): the index cannot say ` +
        `whether ${name} is published; rerun once it answers`,
    );
  }
}

const USAGE =
  "node scripts/release/python/pypi-plan.ts <dist-dir> --manifest <file> --version <version> --index <url> " +
  "--out <upload-dir> [--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("pypi-plan", async () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        index: { type: "string" },
        out: { type: "string" },
      },
      USAGE,
    );
    const directory = positionals[0];

    if (
      directory === undefined ||
      values.manifest === undefined ||
      values.index === undefined ||
      values.out === undefined
    )
      throw new ReleaseError(
        `the distribution directory, --manifest, --index and --out are required; usage: ${USAGE}`,
      );

    const manifest = parsedDistributionManifest(
      readFileSync(values.manifest, "utf8"),
      values.manifest,
    );
    const distributions = manifestDistributions(resolve(directory), manifest, {
      version: releaseVersion(values.version),
      names: releaseDistributionNames(repositoryRoot(values.root)),
    });
    const plan = await uploadPlan(values.index, distributions);

    mkdirSync(values.out, { recursive: true });

    if (readdirSync(values.out).length > 0)
      throw new ReleaseError(
        `${values.out} is not empty: the upload directory holds only what this plan copies`,
      );

    for (const entry of plan.alreadyPublished)
      console.log(`pypi-plan: ${entry.file} is already published with these bytes, skipped`);

    for (const entry of plan.toUpload)
      copyFileSync(join(directory, entry.file), join(values.out, entry.file));

    console.log(
      `pypi-plan: ${plan.toUpload.length} to upload, ${plan.alreadyPublished.length} already there, on ${values.index}`,
    );
  });
