// The idempotent Maven Central publish of a checked staging bundle through the Central Portal publisher API: exactly
// the files of build-jvm's manifest, checked against it. Each artefact version Central lacks goes into one zip
// uploaded as `USER_MANAGED`, polled until the portal has `VALIDATED` it, then published and polled until
// `PUBLISHED`, so the portal's own checks run before anything is public. A version Central holds with the same bytes
// is skipped; one it holds with other bytes fails by name before anything is uploaded, since a published version
// never changes. A failed run can so be rerun as is.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isJsonRecord } from "../json-record.ts";
import { ReleaseError } from "../release-version.ts";
import { isDerivedFile } from "./bundle-layout.ts";
import {
  type BundleManifestEntry,
  checkBundleAgainstManifest,
  sha256Of,
} from "./bundle-manifest.ts";
import { type Coordinate, type ExpectedBundle, versionDirectory } from "./jvm-release.ts";

export const CENTRAL_PORTAL_URL = "https://central.sonatype.com";
export const CENTRAL_REPOSITORY_URL = "https://repo1.maven.org/maven2";

/** The publisher API paths publish-central calls, which the local portal of the rehearsal serves. */
export const PUBLISHER_PATHS = {
  published: "/api/v1/publisher/published",
  upload: "/api/v1/publisher/upload",
  status: "/api/v1/publisher/status",
  /** Followed by the deployment id: publishes a validated deployment. */
  deployment: "/api/v1/publisher/deployment/",
} as const;

const HTTP_NOT_FOUND = 404;
// A portal or repository that does not answer within this time fails the job instead of holding it to its timeout.
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const DEPLOYMENT_FAILED = "FAILED";

export interface CentralPortal {
  /** The portal's base URL, `CENTRAL_PORTAL_URL` in a real run. */
  readonly api: string;
  /** The repository the published files are read back from, `CENTRAL_REPOSITORY_URL` in a real run. */
  readonly repository: string;
  /** The `Authorization` value: `Bearer ` and the base64 of `<user token name>:<user token password>`. */
  readonly authorization: string;
  readonly pollIntervalMilliseconds: number;
  readonly validationTimeoutMilliseconds: number;
  readonly publicationTimeoutMilliseconds: number;
}

export interface CentralPublication {
  readonly published: readonly Coordinate[];
  readonly alreadyPublished: readonly Coordinate[];
}

export function portalAuthorization(username: string, password: string): string {
  return `Bearer ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Publishes the artefact versions Central lacks; throws a `ReleaseError` naming each problem. */
export async function publishToCentral(
  portal: CentralPortal,
  directory: string,
  manifest: readonly BundleManifestEntry[],
  expected: ExpectedBundle,
): Promise<CentralPublication> {
  checkBundleAgainstManifest(directory, manifest);

  const pathsByCoordinate = manifestPathsByCoordinate(manifest, expected);
  const toPublish: Coordinate[] = [];
  const alreadyPublished: Coordinate[] = [];
  const conflicts: string[] = [];

  for (const [coordinate, entries] of pathsByCoordinate) {
    if (!(await isPublished(portal, coordinate, expected.version))) {
      toPublish.push(coordinate);
      continue;
    }

    const differing = await differingFiles(portal, entries);

    if (differing.length === 0) alreadyPublished.push(coordinate);
    else
      conflicts.push(
        `${coordinate.group}:${coordinate.artifactId}:${expected.version} is on Central with other bytes (${differing.join(", ")})`,
      );
  }

  if (conflicts.length > 0)
    throw new ReleaseError(
      `${conflicts.join("; ")}: a published version never changes, so nothing was published; stamp and release a new patch version`,
    );

  if (toPublish.length > 0) {
    const paths = toPublish.flatMap((coordinate) =>
      (pathsByCoordinate.get(coordinate) ?? []).map((entry) => entry.path),
    );
    const deployment = await upload(portal, directory, paths, `seampact-${expected.version}`);

    await waitForState(portal, deployment, "VALIDATED", portal.validationTimeoutMilliseconds);
    await portalRequest(portal, `${PUBLISHER_PATHS.deployment}${encodeURIComponent(deployment)}`, {
      method: "POST",
    });
    await waitForState(portal, deployment, "PUBLISHED", portal.publicationTimeoutMilliseconds);
  }

  return { published: toPublish, alreadyPublished };
}

function manifestPathsByCoordinate(
  manifest: readonly BundleManifestEntry[],
  expected: ExpectedBundle,
): Map<Coordinate, BundleManifestEntry[]> {
  const byCoordinate = new Map<Coordinate, BundleManifestEntry[]>(
    expected.coordinates.map((coordinate) => [coordinate, []]),
  );
  const strays: string[] = [];

  for (const entry of manifest) {
    const coordinate = expected.coordinates.find((candidate) =>
      entry.path.startsWith(`${versionDirectory(candidate, expected.version)}/`),
    );

    if (coordinate === undefined) strays.push(entry.path);
    else byCoordinate.get(coordinate)?.push(entry);
  }

  const empty = [...byCoordinate]
    .filter(([, entries]) => entries.length === 0)
    .map(([coordinate]) => coordinate.artifactId);

  if (strays.length > 0 || empty.length > 0)
    throw new ReleaseError(
      `the manifest is not the ${expected.version} release, so nothing was published: ` +
        [
          ...strays.map((path) => `${path} is no file of it`),
          ...empty.map((artifactId) => `no file of ${artifactId}`),
        ].join("; "),
    );

  return byCoordinate;
}

async function isPublished(
  portal: CentralPortal,
  coordinate: Coordinate,
  version: string,
): Promise<boolean> {
  const query = new URLSearchParams({
    namespace: coordinate.group,
    name: coordinate.artifactId,
    version,
  });
  const answer: unknown = await (
    await portalRequest(portal, `${PUBLISHER_PATHS.published}?${query}`, { method: "GET" })
  ).json();
  const published = isJsonRecord(answer) ? answer.published : undefined;

  if (typeof published !== "boolean")
    throw new ReleaseError(
      `the portal answered no boolean \`published\` for ${coordinate.artifactId}:${version}`,
    );

  return published;
}

// Signatures and digests are left out: a rerun signs again, so its signatures differ while the files are the same.
async function differingFiles(
  portal: CentralPortal,
  entries: readonly BundleManifestEntry[],
): Promise<string[]> {
  const differing: string[] = [];

  for (const entry of entries.filter((candidate) => !isDerivedFile(candidate.path))) {
    const url = `${portal.repository.replace(/\/+$/, "")}/${entry.path}`;
    const response = await timedFetch(url, { method: "GET" });

    if (response.status === HTTP_NOT_FOUND)
      throw new ReleaseError(
        `Central lists ${entry.path} as published, but ${url} does not serve it yet, so its bytes cannot be compared: rerun the job once the repository has it`,
      );

    if (!response.ok)
      throw new ReleaseError(
        `${url} answered ${response.status}: the published bytes cannot be compared`,
      );

    if (sha256Of(new Uint8Array(await response.arrayBuffer())) !== entry.sha256)
      differing.push(entry.path);
  }

  return differing;
}

async function upload(
  portal: CentralPortal,
  directory: string,
  paths: readonly string[],
  name: string,
): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "seampact-central-"));

  try {
    const zip = join(work, `${name}.zip`);

    execFileSync("zip", ["-q", "-X", zip, ...paths], { cwd: directory });

    const form = new FormData();

    form.append("bundle", new Blob([readFileSync(zip)]), `${name}.zip`);

    const query = new URLSearchParams({ name, publishingType: "USER_MANAGED" });
    const deployment = (
      await (
        await portalRequest(portal, `${PUBLISHER_PATHS.upload}?${query}`, {
          method: "POST",
          body: form,
        })
      ).text()
    ).trim();

    if (deployment === "")
      throw new ReleaseError("the portal answered the upload with no deployment id");

    console.log(`publish-central: ${paths.length} files uploaded as deployment ${deployment}`);

    return deployment;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function waitForState(
  portal: CentralPortal,
  deployment: string,
  wanted: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  const query = new URLSearchParams({ id: deployment });

  for (;;) {
    const status: unknown = await (
      await portalRequest(portal, `${PUBLISHER_PATHS.status}?${query}`, { method: "POST" })
    ).json();
    const state = isJsonRecord(status) ? status.deploymentState : undefined;

    if (state === wanted) return;

    if (state === DEPLOYMENT_FAILED)
      throw new ReleaseError(
        `the portal failed deployment ${deployment}: ${JSON.stringify(isJsonRecord(status) ? status.errors : status)}; fix the bundle, then rerun`,
      );

    if (Date.now() >= deadline)
      throw new ReleaseError(
        `deployment ${deployment} is still ${String(state)} after ${timeoutMilliseconds / 1000} s, not ${wanted}: see it on the portal, then rerun`,
      );

    await delay(portal.pollIntervalMilliseconds);
  }
}

async function portalRequest(
  portal: CentralPortal,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${portal.api.replace(/\/+$/, "")}${path}`;
  const response = await timedFetch(url, {
    ...init,
    headers: { Authorization: portal.authorization },
  });

  if (!response.ok)
    throw new ReleaseError(
      `${init.method} ${url} answered ${response.status}: ${(await response.text()).trim()}`,
    );

  return response;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
  } catch (error) {
    throw new ReleaseError(
      `${init.method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
