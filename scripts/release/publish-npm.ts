// The idempotent npm publish of the packed tarballs: exactly the ones pack-npm's manifest lists, checked against it
// and against the packages of the release. Each version the registry lacks is published; one it holds with the same
// bytes is skipped; one it holds with other bytes fails by name before anything is published, since a published
// version never changes. A failed run can so be rerun as is. A registry's 429 Too Many Requests is waited out
// (its `Retry-After`, else a doubling pause) under one total wait; npm's cap on new packages a day, which no wait
// beats, stops the run by name with the packages left.
//   node scripts/release/publish-npm.ts <tarball-dir> --manifest <file> --version <version> --registry <url>
//     [--provenance] [--root <dir>]
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isJsonRecord } from "./json-record.ts";
import { publishedPackageNames } from "./npm-versions.ts";
import { RateLimitWait, retryAfterMilliseconds } from "./rate-limit-wait.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "./release-cli.ts";
import { ReleaseError, releaseVersion } from "./release-version.ts";
import { manifestTarballs, parsedTarballManifest, type Tarball } from "./tarball-manifest.ts";

const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
// npm prints `npm error code E429` and `429 Too Many Requests` when it refuses a publish for its rate.
const NPM_RATE_LIMITED = /\bE429\b|\b429 Too Many Requests\b/;
// The pauses on a 429 double from the first; their total stays well under the publish job's 20-minute timeout.
const FIRST_RATE_LIMIT_PAUSE_MILLISECONDS = 30_000;
const TOTAL_RATE_LIMIT_WAIT_MILLISECONDS = 8 * 60_000;
// A registry that does not answer within this time fails the job instead of holding it to its timeout.
const REGISTRY_TIMEOUT_MILLISECONDS = 30_000;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export interface PlannedPublish {
  readonly tarball: Tarball;
  /** The registry has no version of the package: publishing it creates the package. */
  readonly firstPublish: boolean;
}

export interface PublishPlan {
  readonly toPublish: readonly PlannedPublish[];
  readonly alreadyPublished: readonly Tarball[];
}

type RegistryHolding =
  | { readonly kind: "no-package" }
  | { readonly kind: "no-version" }
  | { readonly kind: "version"; readonly integrity: string };

/** What publishing one tarball gave: published, or refused for the registry's rate. */
export type PublishOutcome = "published" | "rate-limited";

export const rateLimitWait = (): RateLimitWait =>
  new RateLimitWait(FIRST_RATE_LIMIT_PAUSE_MILLISECONDS, TOTAL_RATE_LIMIT_WAIT_MILLISECONDS);

/** Asks the registry for each version; throws a `ReleaseError` naming every version held with other bytes. */
export async function publishPlan(
  registry: string,
  tarballs: readonly Tarball[],
  wait: RateLimitWait = rateLimitWait(),
): Promise<PublishPlan> {
  const toPublish: PlannedPublish[] = [];
  const alreadyPublished: Tarball[] = [];
  const conflicts: string[] = [];

  for (const tarball of tarballs) {
    const holding = await registryHolding(registry, tarball, wait);

    if (holding.kind !== "version")
      toPublish.push({ tarball, firstPublish: holding.kind === "no-package" });
    else if (holding.integrity === tarball.integrity) alreadyPublished.push(tarball);
    else
      conflicts.push(
        `${tarball.name}@${tarball.version} is on ${registry} with other bytes (${holding.integrity}, this tarball ` +
          `is ${tarball.integrity})`,
      );
  }

  if (conflicts.length > 0)
    throw new ReleaseError(
      `${conflicts.join("; ")}: a published version never changes, so nothing was published; stamp and release a ` +
        "new patch version",
    );

  return { toPublish, alreadyPublished };
}

async function registryHolding(
  registry: string,
  tarball: Tarball,
  wait: RateLimitWait,
): Promise<RegistryHolding> {
  const url = `${registry.replace(/\/+$/, "")}/${tarball.name.replace("/", "%2f")}`;
  let response = await fetchPackument(url, tarball.name);

  while (
    response.status === HTTP_TOO_MANY_REQUESTS &&
    (await wait.beforeRetry(
      retryAfterMilliseconds(response.headers.get("retry-after"), Date.now()),
    ))
  )
    response = await fetchPackument(url, tarball.name);

  if (response.status === HTTP_NOT_FOUND) return { kind: "no-package" };

  if (!response.ok)
    throw new ReleaseError(
      `${url} answered ${response.status}: the registry cannot say whether ${tarball.name} is published`,
    );

  const packument: unknown = await response.json();
  const integrity = versionIntegrity(packument, tarball.version);

  if (integrity === null)
    throw new ReleaseError(
      `${url} lists ${tarball.name}@${tarball.version} without a \`dist.integrity\``,
    );

  return integrity === undefined ? { kind: "no-version" } : { kind: "version", integrity };
}

async function fetchPackument(url: string, name: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    throw new ReleaseError(
      `${url} did not answer (${error instanceof Error ? error.message : String(error)}): the registry cannot say ` +
        `whether ${name} is published; rerun once it answers`,
    );
  }
}

// The version's integrity, `undefined` when the version is absent, `null` when it is listed without one.
function versionIntegrity(packument: unknown, version: string): string | undefined | null {
  const versions = isJsonRecord(packument) ? packument.versions : undefined;
  const listed = isJsonRecord(versions) ? versions[version] : undefined;

  if (listed === undefined) return undefined;

  const dist = isJsonRecord(listed) ? listed.dist : undefined;
  const integrity = isJsonRecord(dist) ? dist.integrity : undefined;

  return typeof integrity === "string" ? integrity : null;
}

/**
 * Publishes the plan in order and answers how many were published. A 429 is retried after the wait; one on a first
 * publish once this run created a package is npm's daily cap on new packages, which no wait beats, so the run stops
 * there. Either stop, or a wait spent, throws a `ReleaseError` naming the packages left; the ones published stay.
 */
export async function publishInOrder(
  plan: PublishPlan,
  publishOne: (tarball: Tarball) => PublishOutcome,
  wait: RateLimitWait,
): Promise<number> {
  let published = 0;
  let packagesCreated = 0;

  for (const [index, { tarball, firstPublish }] of plan.toPublish.entries()) {
    let outcome = publishOne(tarball);

    while (outcome === "rate-limited") {
      const dailyCap = firstPublish && packagesCreated > 0;

      if (dailyCap || !(await wait.beforeRetry()))
        throw new ReleaseError(
          rateLimitStop({
            refused: tarball,
            firstPublish,
            left: plan.toPublish.slice(index),
            published,
            packagesCreated,
            wait,
          }),
        );

      outcome = publishOne(tarball);
    }

    published += 1;
    if (firstPublish) packagesCreated += 1;
  }

  return published;
}

interface RateLimitStop {
  readonly refused: Tarball;
  readonly firstPublish: boolean;
  /** The refused tarball and every one after it. */
  readonly left: readonly PlannedPublish[];
  readonly published: number;
  readonly packagesCreated: number;
  readonly wait: RateLimitWait;
}

function rateLimitStop(run: RateLimitStop): string {
  const { refused, left } = run;
  const names = left.map(({ tarball }) => tarball.name).join(", ");
  const stays = `${run.published} published in this run stay, a rerun skips them`;

  if (run.firstPublish)
    return (
      `npm refused to create ${refused.name} (429 Too Many Requests) after ${run.packagesCreated} new ` +
      `packages in this run and ${run.wait.waitedMinutes} minutes of waiting: npm caps the new packages an account ` +
      `creates in a day. ${left.length} left to publish (${names}); ${stays}: rerun publish-npm in about 24 hours`
    );

  return (
    `npm still refuses ${refused.name}@${refused.version} (429 Too Many Requests) after ` +
    `${run.wait.waitedMinutes} minutes of waiting. ${left.length} left to publish (${names}); ${stays}: rerun ` +
    "publish-npm in an hour"
  );
}

function publish(
  registry: string,
  tarball: Tarball,
  extraArguments: readonly string[],
): PublishOutcome {
  const args = [
    "publish",
    tarball.file,
    "--access",
    "public",
    "--registry",
    registry,
    ...extraArguments,
  ];

  console.log(`\n> ${NPM} ${args.join(" ")}`);

  // npm's output is read for a 429, then shown as it came.
  const result = spawnSync(NPM, args, { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  if (result.status !== 0 && NPM_RATE_LIMITED.test(`${result.stdout}\n${result.stderr}`)) {
    console.log(
      `publish-npm: npm answered 429 Too Many Requests for ${tarball.name}@${tarball.version}`,
    );
    return "rate-limited";
  }

  if (result.status !== 0)
    throw new ReleaseError(
      `npm publish of ${tarball.name}@${tarball.version} failed (${result.error?.message ?? `exit ${result.status}`}); ` +
        "the versions published before it stay, and a rerun skips them",
    );

  return "published";
}

const USAGE =
  "node scripts/release/publish-npm.ts <tarball-dir> --manifest <file> --version <version> --registry <url> " +
  "[--provenance] [--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("publish-npm", async () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        registry: { type: "string" },
        provenance: { type: "boolean" },
      },
      USAGE,
    );
    const directory = positionals[0];

    if (directory === undefined || values.registry === undefined || values.manifest === undefined)
      throw new ReleaseError(
        `the tarball directory, --manifest and --registry are required; usage: ${USAGE}`,
      );

    const version = releaseVersion(values.version);
    const manifest = parsedTarballManifest(readFileSync(values.manifest, "utf8"), values.manifest);
    const tarballs = manifestTarballs(resolve(directory), manifest, {
      version,
      names: publishedPackageNames(repositoryRoot(values.root)),
    });
    const wait = rateLimitWait();
    const plan = await publishPlan(values.registry, tarballs, wait);

    for (const tarball of plan.alreadyPublished)
      console.log(
        `publish-npm: ${tarball.name}@${tarball.version} is already published with these bytes, skipped`,
      );

    const extraArguments = values.provenance === true ? ["--provenance"] : [];
    const registry = values.registry;
    const published = await publishInOrder(
      plan,
      (tarball) => publish(registry, tarball, extraArguments),
      wait,
    );

    console.log(
      `publish-npm: ${published} published, ${plan.alreadyPublished.length} already there, on ${registry}`,
    );
  });
