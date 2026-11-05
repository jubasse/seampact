import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { bundleManifest } from "./bundle-manifest.ts";
import {
  type CentralPortal,
  PORTAL_TEXT_LIMIT,
  PUBLISHER_PATHS,
  portalAuthorization,
  publishToCentral,
} from "./central-portal.ts";
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

function portalAt(url: string): CentralPortal {
  return {
    api: url,
    repository: `${url}/maven2`,
    authorization: portalAuthorization("rehearsal", "rehearsal"),
    pollIntervalMilliseconds: 1,
    validationTimeoutMilliseconds: 5_000,
    publicationTimeoutMilliseconds: 5_000,
  };
}

async function localPortal(): Promise<{ portal: CentralPortal; published: string }> {
  const published = temporaryDirectory("central-published-");
  const local = await startLocalPortal(published, temporaryDirectory("central-portal-work-"));

  cleanups.push(local.close);

  return {
    published,
    portal: portalAt(local.url),
  };
}

// A portal on its own thread, as on its own server, that closes a connection idle for
// `IDLE_CLOSE_MILLISECONDS` after answering whether a version is published, with no keep-alive hint.
async function closingIdlePortal(): Promise<CentralPortal> {
  const worker = new Worker(
    `const { createServer } = require("node:http");
    const { parentPort, workerData } = require("node:worker_threads");
    let state = "VALIDATED";
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const path = request.url ?? "";

        if (path.startsWith(workerData.paths.published)) {
          response.end(JSON.stringify({ published: false }));
          setTimeout(() => request.socket.destroy(), workerData.idleCloseMilliseconds);
        } else if (path.startsWith(workerData.paths.upload)) {
          response.writeHead(201).end("deployment-1");
        } else if (path.startsWith(workerData.paths.status)) {
          response.end(JSON.stringify({ deploymentState: state }));
        } else {
          state = "PUBLISHED";
          response.writeHead(204).end();
        }
      });
    });

    server.keepAliveTimeout = 0;
    server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));`,
    {
      eval: true,
      workerData: { paths: PUBLISHER_PATHS, idleCloseMilliseconds: IDLE_CLOSE_MILLISECONDS },
    },
  );

  cleanups.push(async () => {
    await worker.terminate();
  });

  const port = await new Promise<number>((started, failed) => {
    worker.once("message", started);
    worker.once("error", failed);
  });

  return portalAt(`http://127.0.0.1:${port}`);
}

// A jar slow enough to zip, and too large for the socket buffers, that a portal closing idle connections
// this soon closes them meanwhile, and the upload writes into a closed connection.
const IDLE_CLOSE_MILLISECONDS = 20;
const SLOW_TO_ZIP_BYTES = 24 * 1024 * 1024;

const LONG_PORTAL_TEXT = "x".repeat(PORTAL_TEXT_LIMIT * 3);

// A portal that lacks the version, takes the upload, then fails the deployment, or refuses the upload, with a long text.
async function failingPortal(failure: "deployment" | "upload"): Promise<CentralPortal> {
  const server = createServer((request, response) => {
    request.resume();

    const path = request.url ?? "";

    if (path.startsWith(PUBLISHER_PATHS.published)) {
      response.end(JSON.stringify({ published: false }));

      return;
    }

    if (path.startsWith(PUBLISHER_PATHS.upload)) {
      response.statusCode = failure === "upload" ? 400 : 201;
      response.end(failure === "upload" ? LONG_PORTAL_TEXT : "deployment-1");

      return;
    }

    response.end(
      JSON.stringify({ deploymentState: "FAILED", errors: { bundle: [LONG_PORTAL_TEXT] } }),
    );
  });

  await new Promise<void>((started) => server.listen(0, "127.0.0.1", started));
  cleanups.push(() => new Promise<void>((closed) => server.close(() => closed())));

  const address = server.address();
  const url =
    typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}` : "";

  return portalAt(url);
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

  // The zip of a real bundle takes longer than a server keeps an idle connection open: the upload must not go out
  // on a connection the portal closed meanwhile.
  it("uploads on a live connection after the portal closed the idle ones", async () => {
    const portal = await closingIdlePortal();
    const bundle = stagedJar(randomBytes(SLOW_TO_ZIP_BYTES).toString("base64"));
    const secondJar = JAR.replaceAll("seampact-hooks", "seampact-ir");

    mkdirSync(dirname(join(bundle, secondJar)), { recursive: true });
    writeFileSync(join(bundle, secondJar), "classes");
    // Two artefacts, so the portal is asked twice before the upload, as for a real bundle.
    const twoArtefacts: ExpectedBundle = {
      ...expected,
      coordinates: [...expected.coordinates, { group: JVM_GROUP, artifactId: "seampact-ir" }],
    };

    const publication = await publishToCentral(
      portal,
      bundle,
      bundleManifest(bundle),
      twoArtefacts,
    );

    expect(publication.published).toEqual(twoArtefacts.coordinates);
  });

  it("removes the portal's working folder when it stops", async () => {
    const work = temporaryDirectory("central-portal-work-");
    const local = await startLocalPortal(temporaryDirectory("central-published-"), work);
    const bundle = stagedJar("classes");

    await publishToCentral(portalAt(local.url), bundle, bundleManifest(bundle), expected);
    const duringTheRun = readdirSync(work);

    await local.close();

    expect(duringTheRun).toHaveLength(1);
    expect(readdirSync(work)).toEqual([]);
  });

  it("names the network error under a failed request", async () => {
    const server = createServer();

    await new Promise<void>((started) => server.listen(0, "127.0.0.1", started));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    await new Promise<void>((closed) => server.close(() => closed()));
    const bundle = stagedJar("classes");

    await expect(
      publishToCentral(
        portalAt(`http://127.0.0.1:${port}`),
        bundle,
        bundleManifest(bundle),
        expected,
      ),
    ).rejects.toThrow(/ failed: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:/);
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

  it("names an earlier deployment still publishing when the portal fails the upload, and bounds its errors", async () => {
    const portal = await failingPortal("deployment");
    const bundle = stagedJar("classes");
    const failure = publishToCentral(portal, bundle, bundleManifest(bundle), expected);

    await expect(failure).rejects.toThrow(
      "if an earlier deployment of this version is still publishing or validated (a rerun after a timeout or a cancel), wait for it on central.sonatype.com, then rerun; otherwise fix the bundle, then rerun",
    );
    await expect(failure).rejects.toThrow(/more characters\)/);
    await expect(failure).rejects.not.toThrow(LONG_PORTAL_TEXT);
  });

  it("bounds the text of a refused request", async () => {
    const portal = await failingPortal("upload");
    const bundle = stagedJar("classes");
    const failure = publishToCentral(portal, bundle, bundleManifest(bundle), expected);

    await expect(failure).rejects.toThrow(/answered 400: x+\.\.\. \(8000 more characters\)$/);
  });
});
