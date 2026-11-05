// The command line of the Maven Central publish (`central-portal.ts`). The user token comes from the environment,
// `MAVEN_CENTRAL_USERNAME` and `MAVEN_CENTRAL_PASSWORD`, never from an argument. The rehearsal points `--portal` and
// `--repository` at the local portal.
//   node scripts/release/jvm/publish-central.ts <dir> --manifest <file> --version <version> [--portal <url>]
//     [--repository <url>] [--root <dir>]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import { parsedBundleManifest } from "./bundle-manifest.ts";
import {
  CENTRAL_PORTAL_URL,
  CENTRAL_REPOSITORY_URL,
  portalAuthorization,
  publishToCentral,
} from "./central-portal.ts";
import { expectedBundle } from "./jvm-release.ts";

const USAGE =
  "publish-central.ts <dir> --manifest <file> --version <version> [--portal <url>] [--repository <url>]";
const POLL_INTERVAL_MILLISECONDS = 10_000;
const VALIDATION_TIMEOUT_MILLISECONDS = 30 * 60_000;
// Central syncs a published deployment to repo1 within about 30 minutes.
const PUBLICATION_TIMEOUT_MILLISECONDS = 60 * 60_000;

function environmentValue(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "")
    throw new ReleaseError(
      `${name} is not set: the publish reads the Central user token from the environment`,
    );

  return value;
}

if (import.meta.main)
  await runReleaseCommand("publish-central", async () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        portal: { type: "string" },
        repository: { type: "string" },
      },
      USAGE,
    );
    const [directory] = positionals;

    if (directory === undefined || values.manifest === undefined)
      throw new ReleaseError(`usage: ${USAGE}`);

    const version = releaseVersion(values.version);
    const manifest = parsedBundleManifest(readFileSync(values.manifest, "utf8"), values.manifest);
    const portal = {
      api: values.portal ?? CENTRAL_PORTAL_URL,
      repository: values.repository ?? CENTRAL_REPOSITORY_URL,
      authorization: portalAuthorization(
        environmentValue("MAVEN_CENTRAL_USERNAME"),
        environmentValue("MAVEN_CENTRAL_PASSWORD"),
      ),
      pollIntervalMilliseconds: POLL_INTERVAL_MILLISECONDS,
      validationTimeoutMilliseconds: VALIDATION_TIMEOUT_MILLISECONDS,
      publicationTimeoutMilliseconds: PUBLICATION_TIMEOUT_MILLISECONDS,
    };
    const expected = expectedBundle(repositoryRoot(values.root), "central", version);
    const publication = await publishToCentral(portal, resolve(directory), manifest, expected);

    for (const coordinate of publication.alreadyPublished)
      console.log(
        `publish-central: ${coordinate.artifactId}:${version} is already published with these bytes, skipped`,
      );

    console.log(
      `publish-central: ${publication.published.length} published, ${publication.alreadyPublished.length} already there, on ${portal.api}`,
    );
  });
