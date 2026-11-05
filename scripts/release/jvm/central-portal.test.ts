import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleManifest } from "./bundle-manifest.ts";
import { type CentralPortal, portalAuthorization, publishToCentral } from "./central-portal.ts";
import { type ExpectedBundle, JVM_GROUP } from "./jvm-release.ts";
import { startLocalPortal } from "./local-portal.ts";

const VERSION = "1.2.3";
const JAR = `io/github/jubasse/seampact-hooks/${VERSION}/seampact-hooks-${VERSION}.jar`;
const expected: ExpectedBundle = {
  version: VERSION,
  coordinates: [{ group: JVM_GROUP, artifactId: "seampact-hooks" }],
  compilerClassifiers: new Map(),
};

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const temporaryDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  return directory;
};

function stagedJar(bytes: string): string {
  const repository = temporaryDirectory("central-bundle-");

  mkdirSync(dirname(join(repository, JAR)), { recursive: true });
  writeFileSync(join(repository, JAR), bytes);
  writeFileSync(join(repository, `${JAR}.asc`), `signature of ${bytes}`);

  return repository;
}

async function localPortal(): Promise<{ portal: CentralPortal; published: string }> {
  const published = temporaryDirectory("central-published-");
  const local = await startLocalPortal(published);

  cleanups.push(local.close);

  return {
    published,
    portal: {
      api: local.url,
      repository: `${local.url}/maven2`,
      authorization: portalAuthorization("rehearsal", "rehearsal"),
      pollIntervalMilliseconds: 1,
      validationTimeoutMilliseconds: 5_000,
      publicationTimeoutMilliseconds: 5_000,
    },
  };
}

describe("the Central publish", () => {
  it("uploads, validates and publishes a version Central lacks, then skips it with the same bytes", async () => {
    const { portal, published } = await localPortal();
    const bundle = stagedJar("classes");

    const first = await publishToCentral(portal, bundle, bundleManifest(bundle), expected);
    // A rerun signs again: other signature bytes, the same files.
    const rerun = stagedJar("classes");

    writeFileSync(join(rerun, `${JAR}.asc`), "a new signature");
    const second = await publishToCentral(portal, rerun, bundleManifest(rerun), expected);

    expect(first.published.map((coordinate) => coordinate.artifactId)).toEqual(["seampact-hooks"]);
    expect(second).toEqual({ published: [], alreadyPublished: expected.coordinates });
    expect(bundleManifest(published).map((entry) => entry.path)).toEqual([JAR, `${JAR}.asc`]);
  });

  it("fails by name, uploading nothing, on a version Central holds with other bytes", async () => {
    const { portal } = await localPortal();
    const bundle = stagedJar("classes");

    await publishToCentral(portal, bundle, bundleManifest(bundle), expected);

    const changed = stagedJar("other classes");

    await expect(
      publishToCentral(portal, changed, bundleManifest(changed), expected),
    ).rejects.toThrow(
      `io.github.jubasse:seampact-hooks:${VERSION} is on Central with other bytes (${JAR}): a published version never changes`,
    );
  });

  it("refuses a bundle whose files differ from the manifest before asking Central", async () => {
    const { portal } = await localPortal();
    const bundle = stagedJar("classes");
    const manifest = bundleManifest(bundle);

    writeFileSync(join(bundle, JAR), "replaced");

    await expect(publishToCentral(portal, bundle, manifest, expected)).rejects.toThrow(
      /the bundle is not the one build-jvm checked, so nothing was published/,
    );
  });
});
