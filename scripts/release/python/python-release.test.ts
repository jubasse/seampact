import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPILER_DISTRIBUTION,
  compilerWheelProblems,
  type DistributionManifestEntry,
  distributionIdentity,
  distributionManifest,
  manifestDistributions,
} from "./dist-manifest.ts";
import { uploadToLocalIndex } from "./local-index.ts";
import { uploadPlan } from "./pypi-plan.ts";

const VERSION = "1.2.3";
const NAMES = [COMPILER_DISTRIBUTION, "seampact-ir"];
const ASSETS = [
  "seampact-darwin-arm64",
  "seampact-darwin-x64",
  "seampact-linux-arm64",
  "seampact-linux-x64",
  "seampact-win32-x64.exe",
];
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const LOOPBACK = "127.0.0.1";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const temporaryDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  return directory;
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// A zip file holding the members, each with the given text.
function writeZip(file: string, members: Readonly<Record<string, string>>): void {
  const tree = temporaryDirectory("python-release-wheel-");

  for (const [member, text] of Object.entries(members)) {
    mkdirSync(join(tree, member, ".."), { recursive: true });
    writeFileSync(join(tree, member), text);
  }

  execFileSync("zip", ["-q", "-r", file, "."], { cwd: tree });
}

// A release's distributions: seampact-ir's wheel and sdist, and one seampact-compiler wheel per asset, holding the
// asset's text, plus the SHA256SUMS of those texts.
function releaseDirectory(binaryText: (asset: string) => string = (asset) => `binary ${asset}`) {
  const directory = temporaryDirectory("python-release-dists-");

  writeZip(join(directory, `seampact_ir-${VERSION}-py3-none-any.whl`), {
    "seampact/ir/__init__.py": "",
  });
  writeFileSync(join(directory, `seampact_ir-${VERSION}.tar.gz`), "sdist");

  for (const [index, asset] of ASSETS.entries())
    writeZip(join(directory, `seampact_compiler-${VERSION}-py3-none-platform${index}.whl`), {
      [`seampact/compiler/bin/${asset}`]: binaryText(asset),
    });

  const sums = ASSETS.map((asset) => `${sha256(`binary ${asset}`)}  ${asset}`).join("\n");

  return { directory, sums: `${sums}\n` };
}

// Serves a directory as static files, as `python3 -m http.server` serves the rehearsal's index.
async function staticServer(root: string): Promise<string> {
  const server: Server = createServer((request, response) => {
    const path = normalize(join(root, decodeURIComponent(request.url ?? "/")));

    readFile(path).then(
      (bytes) => {
        response.writeHead(HTTP_OK);
        response.end(bytes);
      },
      () => {
        response.writeHead(HTTP_NOT_FOUND);
        response.end();
      },
    );
  });

  await new Promise<void>((resolveListen) => server.listen(0, LOOPBACK, resolveListen));
  cleanups.push(() => server.close());

  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("the index server has no port");

  return `http://${LOOPBACK}:${address.port}`;
}

const expected = { version: VERSION, names: NAMES };

describe("the distribution manifest", () => {
  it("reads the name, version and kind of a wheel or an sdist, and refuses any other file by name", () => {
    expect(distributionIdentity("seampact_signed_webhooks-1.0.0-py3-none-any.whl")).toEqual({
      name: "seampact-signed-webhooks",
      version: "1.0.0",
      kind: "wheel",
    });
    expect(distributionIdentity("seampact_ir-1.0.0.tar.gz")).toEqual({
      name: "seampact-ir",
      version: "1.0.0",
      kind: "sdist",
    });
    expect(() => distributionIdentity("seampact_ir-1.0.0.zip")).toThrow(
      /seampact_ir-1\.0\.0\.zip is neither a wheel/,
    );
  });

  it("accepts the release as built and its compiler wheels holding the binaries of SHA256SUMS", () => {
    const { directory, sums } = releaseDirectory();
    const manifest = distributionManifest(directory);

    expect(manifestDistributions(directory, manifest, expected)).toHaveLength(7);
    expect(compilerWheelProblems(directory, manifest, sums)).toEqual([]);
  });

  it("refuses a missing sdist, a version off the release and a file the manifest does not list", () => {
    const { directory } = releaseDirectory();
    const manifest = distributionManifest(directory).filter((entry) => entry.kind !== "sdist");

    writeFileSync(join(directory, "seampact_ir-1.2.4-py3-none-any.whl"), "");

    expect(() =>
      manifestDistributions(directory, distributionManifest(directory), expected),
    ).toThrow(/seampact_ir-1\.2\.4-py3-none-any\.whl is seampact-ir 1\.2\.4, not at 1\.2\.3/);
    expect(() => manifestDistributions(directory, manifest, expected)).toThrow(
      /seampact-ir has 1 wheels and 0 sdists, not the 1 and 1[\s\S]*seampact_ir-1\.2\.3\.tar\.gz is in the artefact, but not in the manifest/,
    );
  });

  it("refuses a file whose bytes changed after the manifest was written", () => {
    const { directory } = releaseDirectory();
    const manifest = distributionManifest(directory);

    writeFileSync(join(directory, `seampact_ir-${VERSION}.tar.gz`), "replaced");

    expect(() => manifestDistributions(directory, manifest, expected)).toThrow(
      new RegExp(
        `seampact_ir-1\\.2\\.3\\.tar\\.gz hashes ${sha256("replaced")}, not the ${sha256("sdist")}`,
      ),
    );
  });

  it("refuses a compiler wheel whose binary is not the one SHA256SUMS lists", () => {
    const { directory, sums } = releaseDirectory((asset) =>
      asset === "seampact-linux-x64" ? "tampered" : `binary ${asset}`,
    );
    const problems = compilerWheelProblems(directory, distributionManifest(directory), sums);

    expect(problems).toEqual([
      expect.stringMatching(
        new RegExp(
          `holds seampact-linux-x64 hashing ${sha256("tampered")}, not the ${sha256("binary seampact-linux-x64")}`,
        ),
      ),
    ]);
  });
});

describe("the PyPI upload plan", () => {
  const plannedFiles = (entries: readonly DistributionManifestEntry[]) =>
    entries.map((entry) => entry.file).sort();

  it("uploads everything to an empty index, then nothing once the index holds the same bytes", async () => {
    const { directory } = releaseDirectory();
    const manifest = distributionManifest(directory);
    const indexRoot = temporaryDirectory("python-release-index-");
    const index = await staticServer(indexRoot);
    const first = await uploadPlan(index, manifest);

    expect(plannedFiles(first.toUpload)).toEqual(manifest.map((entry) => entry.file).sort());

    expect(uploadToLocalIndex(directory, indexRoot)).toBe(7);

    const second = await uploadPlan(index, manifest);

    expect(second.toUpload).toEqual([]);
    expect(plannedFiles(second.alreadyPublished)).toEqual(plannedFiles(manifest));
  });

  it("uploads only the files a partly published release lacks", async () => {
    const { directory } = releaseDirectory();
    const manifest = distributionManifest(directory);
    const indexRoot = temporaryDirectory("python-release-index-");
    const partial = temporaryDirectory("python-release-partial-");

    execFileSync("cp", [join(directory, `seampact_ir-${VERSION}.tar.gz`), partial]);
    uploadToLocalIndex(partial, indexRoot);

    const plan = await uploadPlan(await staticServer(indexRoot), manifest);

    expect(plannedFiles(plan.alreadyPublished)).toEqual([`seampact_ir-${VERSION}.tar.gz`]);
    expect(plan.toUpload).toHaveLength(6);
  });

  it("fails by name, before any upload, on a file held with other bytes or one the run did not build", async () => {
    const { directory } = releaseDirectory();
    const manifest = distributionManifest(directory);
    const indexRoot = temporaryDirectory("python-release-index-");
    const other = temporaryDirectory("python-release-other-");

    writeFileSync(join(other, `seampact_ir-${VERSION}.tar.gz`), "other bytes");
    writeFileSync(join(other, `seampact_ir-${VERSION}-py3-none-manylinux_2_28_x86_64.whl`), "");
    uploadToLocalIndex(other, indexRoot);

    const plan = uploadPlan(await staticServer(indexRoot), manifest);

    await expect(plan).rejects.toThrow(
      new RegExp(
        `seampact_ir-1\\.2\\.3\\.tar\\.gz is on http://127\\.0\\.0\\.1:\\d+ with other bytes \\(${sha256("other bytes")}, ` +
          `this file is ${sha256("sdist")}\\); seampact-ir 1\\.2\\.3 on http://127\\.0\\.0\\.1:\\d+ holds ` +
          "seampact_ir-1\\.2\\.3-py3-none-manylinux_2_28_x86_64\\.whl, which this run did not build: a published file never changes",
      ),
    );
  });

  it("refuses to replace a file of the local index with other bytes", () => {
    const indexRoot = temporaryDirectory("python-release-index-");
    const first = temporaryDirectory("python-release-first-");
    const second = temporaryDirectory("python-release-second-");

    writeFileSync(join(first, `seampact_ir-${VERSION}.tar.gz`), "first");
    writeFileSync(join(second, `seampact_ir-${VERSION}.tar.gz`), "second");
    uploadToLocalIndex(first, indexRoot);

    expect(() => uploadToLocalIndex(second, indexRoot)).toThrow(
      /is on the local index with other bytes/,
    );
  });
});
