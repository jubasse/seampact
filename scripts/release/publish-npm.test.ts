import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type PublishOutcome, publishInOrder, publishPlan } from "./publish-npm.ts";
import { RateLimitWait, retryAfterMilliseconds } from "./rate-limit-wait.ts";
import { manifestTarballs, type Tarball, tarballManifest } from "./tarball-manifest.ts";

const VERSION = "1.2.3";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
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

const REPRODUCIBLE_TAR_OPTIONS = [
  "--mtime=@0",
  "--sort=name",
  "--owner=0",
  "--group=0",
  "--numeric-owner",
  "--mode=u=rwX,go=rX",
];

const tarballFileName = (name: string, version: string) =>
  `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;

// Writes a `pnpm pack`-shaped tarball of the package into the directory, and returns its file name.
function writeTarball(directory: string, name: string, version = VERSION): string {
  const tree = temporaryDirectory("release-package-");
  const file = tarballFileName(name, version);

  mkdirSync(join(tree, "package"));
  writeFileSync(join(tree, "package", "package.json"), JSON.stringify({ name, version }));
  // A fixed time, order and owner, then gzip without its own time stamp: the same package always gives the same
  // bytes, as `pnpm pack` does, so a test can rewrite a tarball and expect its manifest hash to hold.
  const archive = join(tree, "package.tar");

  execFileSync("tar", [...REPRODUCIBLE_TAR_OPTIONS, "-cf", archive, "-C", tree, "package"]);
  writeFileSync(join(directory, file), execFileSync("gzip", ["-n", "-c", archive]));

  return file;
}

describe("the test tarballs", () => {
  it("are the same bytes when the same package is written twice, a second apart", () => {
    const first = temporaryDirectory("release-tarball-first-");
    const second = temporaryDirectory("release-tarball-second-");
    const file = writeTarball(first, "@seampact/spec");

    execFileSync("sleep", ["1.1"]);
    writeTarball(second, "@seampact/spec");

    expect(readFileSync(join(second, file)).equals(readFileSync(join(first, file)))).toBe(true);
  });
});

// A directory of tarballs, one per package name, read through their manifest.
function tarballDirectory(names: readonly string[]): Tarball[] {
  const directory = temporaryDirectory("release-publish-");
  const files = names.map((name) => writeTarball(directory, name));

  return manifestTarballs(directory, tarballManifest(directory, files), {
    version: VERSION,
    names,
  });
}

// A registry serving the given packuments by URL path, and 404 for every other package; it first answers the
// paths of [rateLimited] once with a 429 and their `Retry-After`.
async function registry(
  packumentByPath: ReadonlyMap<string, unknown>,
  rateLimited: Map<string, string> = new Map(),
): Promise<string> {
  const server: Server = createServer((request, response) => {
    const retryAfter = rateLimited.get(request.url ?? "");

    if (retryAfter !== undefined) {
      rateLimited.delete(request.url ?? "");
      response.writeHead(HTTP_TOO_MANY_REQUESTS, { "retry-after": retryAfter });
      response.end();
      return;
    }

    const packument = packumentByPath.get(request.url ?? "");

    response.writeHead(packument === undefined ? HTTP_NOT_FOUND : HTTP_OK, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(packument ?? { error: "not found" }));
  });

  await new Promise<void>((listening) => server.listen(0, LOOPBACK, listening));
  cleanups.push(() => server.close());

  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("the registry has no TCP address");

  return `http://${LOOPBACK}:${address.port}/`;
}

const packumentOf = (integrity: string) => ({ versions: { [VERSION]: { dist: { integrity } } } });

describe("the idempotent publish to npm", () => {
  it("publishes a missing version or package and skips a version held with the same bytes", async () => {
    const [cli, hal, spec] = tarballDirectory([
      "@seampact/cli",
      "@seampact/pack-hal",
      "@seampact/spec",
    ]);

    if (cli === undefined || hal === undefined || spec === undefined)
      throw new Error("three tarballs expected");

    const url = await registry(
      new Map<string, unknown>([
        ["/@seampact%2fcli", packumentOf(cli.integrity)],
        [
          "/@seampact%2fpack-hal",
          { versions: { "1.0.0": { dist: { integrity: "sha512-older" } } } },
        ],
      ]),
    );
    const plan = await publishPlan(url, [cli, hal, spec]);

    expect(plan.alreadyPublished.map((tarball) => tarball.name)).toEqual(["@seampact/cli"]);
    expect(
      plan.toPublish.map(({ tarball, firstPublish }) => ({ name: tarball.name, firstPublish })),
    ).toEqual([
      { name: "@seampact/pack-hal", firstPublish: false },
      { name: "@seampact/spec", firstPublish: true },
    ]);
  });

  it("asks the registry again after the Retry-After of a 429", async () => {
    const tarballs = tarballDirectory(["@seampact/spec"]);
    const url = await registry(new Map(), new Map([["/@seampact%2fspec", "3"]]));
    const pauses: number[] = [];
    const plan = await publishPlan(url, tarballs, recordingWait(pauses, 10_000));

    expect(pauses).toEqual([3000]);
    expect(plan.toPublish).toHaveLength(1);
  });

  it("fails by name, before publishing anything, on a version held with other bytes", async () => {
    const tarballs = tarballDirectory(["@seampact/cli", "@seampact/spec"]);
    const url = await registry(new Map([["/@seampact%2fspec", packumentOf("sha512-other")]]));

    await expect(publishPlan(url, tarballs)).rejects.toThrow(
      new RegExp(
        `^@seampact/spec@${VERSION} is on .* with other bytes .*: a published version never changes, so nothing was published; stamp and release a new patch version$`,
      ),
    );
  });

  it("reads the integrity npm stores, the SHA-512 of the tarball's bytes", () => {
    const [cli] = tarballDirectory(["@seampact/cli"]);

    expect(cli).toMatchObject({ name: "@seampact/cli", version: VERSION });
    expect(cli?.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
  });
});

describe("the tarballs a publish takes", () => {
  const NAMES = ["@seampact/cli", "@seampact/spec"];

  function packedRelease() {
    const directory = temporaryDirectory("release-artefact-");
    const files = NAMES.map((name) => writeTarball(directory, name));

    return { directory, manifest: tarballManifest(directory, files) };
  }

  it("are exactly the manifest's, at the release, with the release's names", () => {
    const { directory, manifest } = packedRelease();

    expect(
      manifestTarballs(directory, manifest, { version: VERSION, names: NAMES }).map(
        (tarball) => `${tarball.name}@${tarball.version}`,
      ),
    ).toEqual([`@seampact/cli@${VERSION}`, `@seampact/spec@${VERSION}`]);
  });

  it("refuse a tarball added to the artefact, and one whose bytes changed", () => {
    const { directory, manifest } = packedRelease();

    writeTarball(directory, "left-pad", "9.9.9");
    writeTarball(directory, "@seampact/spec", VERSION);
    const rewritten = tarballFileName("@seampact/cli", VERSION);

    writeFileSync(join(directory, rewritten), "other bytes");

    expect(() => manifestTarballs(directory, manifest, { version: VERSION, names: NAMES })).toThrow(
      new RegExp(
        [
          "^the tarballs are not the ones pack-npm checked, so nothing was published:",
          "  left-pad-9\\.9\\.9\\.tgz is in the artefact, but not in the manifest",
          `  seampact-cli-1\\.2\\.3\\.tgz hashes [0-9a-f]{64}, not the [0-9a-f]{64} pack-npm wrote$`,
        ].join("\n"),
      ),
    );
  });

  it("refuse a manifest that is not the release: another version, a missing or a foreign package", () => {
    const directory = temporaryDirectory("release-artefact-");
    const files = [
      writeTarball(directory, "@seampact/cli", "0.0.1"),
      writeTarball(directory, "left-pad", "9.9.9"),
    ];

    expect(() =>
      manifestTarballs(directory, tarballManifest(directory, files), {
        version: VERSION,
        names: NAMES,
      }),
    ).toThrow(
      [
        "the tarballs are not the ones pack-npm checked, so nothing was published:",
        "  left-pad-9.9.9.tgz is left-pad@9.9.9, not at 1.2.3",
        `  seampact-cli-0.0.1.tgz is @seampact/cli@0.0.1, not at ${VERSION}`,
        "  no tarball of @seampact/spec, which the release publishes",
        "  left-pad is not a package the release publishes",
      ].join("\n"),
    );
  });

  it("refuse a tarball whose package.json differs from its manifest entry, or has no name", () => {
    const { directory, manifest } = packedRelease();
    const [cli, spec] = manifest;

    if (cli === undefined || spec === undefined) throw new Error("two entries expected");

    expect(() =>
      manifestTarballs(
        directory,
        [
          { ...cli, name: "@seampact/spec" },
          { ...spec, name: "@seampact/cli" },
        ],
        {
          version: VERSION,
          names: NAMES,
        },
      ),
    ).toThrow(`  ${cli.file} packs @seampact/cli@${VERSION}, not @seampact/spec@${VERSION}`);

    const nameless = temporaryDirectory("release-package-");

    mkdirSync(join(nameless, "package"));
    writeFileSync(join(nameless, "package", "package.json"), JSON.stringify({ version: VERSION }));
    execFileSync("tar", ["-czf", join(directory, "nameless.tgz"), "-C", nameless, "package"]);

    expect(() => tarballManifest(directory, ["nameless.tgz"])).toThrow(
      "nameless.tgz: its package/package.json has no string name and version",
    );
  });
});

// A wait of 10 then 20 milliseconds and so on, [total] in all, that records each pause instead of sleeping.
const recordingWait = (pauses: number[], total = 100) =>
  new RateLimitWait(10, total, async (milliseconds) => {
    pauses.push(milliseconds);
  });

// A publish that answers each package's outcomes in turn, then `published`, and records each call.
function scriptedPublish(outcomesByName: Record<string, PublishOutcome[]>, calls: string[]) {
  return (tarball: Tarball): PublishOutcome => {
    calls.push(tarball.name);

    return outcomesByName[tarball.name]?.shift() ?? "published";
  };
}

const planOf = (names: readonly string[], firstPublish: boolean) => ({
  toPublish: tarballDirectory(names).map((tarball) => ({ tarball, firstPublish })),
  alreadyPublished: [],
});

describe("a publish npm refuses with 429 Too Many Requests", () => {
  it("is retried after a doubling pause, then the run goes on", async () => {
    const plan = planOf(["@seampact/cli", "@seampact/spec"], false);
    const calls: string[] = [];
    const pauses: number[] = [];
    const publishOne = scriptedPublish(
      { "@seampact/cli": ["rate-limited", "rate-limited"] },
      calls,
    );

    await expect(publishInOrder(plan, publishOne, recordingWait(pauses))).resolves.toBe(2);
    expect(pauses).toEqual([10, 20]);
    expect(calls).toEqual(["@seampact/cli", "@seampact/cli", "@seampact/cli", "@seampact/spec"]);
  });

  it("stops at once on a first publish after new packages, naming the ones left, the published ones kept", async () => {
    const plan = planOf(["@seampact/cli", "@seampact/pack-hal", "@seampact/spec"], true);
    const calls: string[] = [];
    const pauses: number[] = [];
    const publishOne = scriptedPublish({ "@seampact/pack-hal": ["rate-limited"] }, calls);

    await expect(publishInOrder(plan, publishOne, recordingWait(pauses))).rejects.toThrow(
      "npm refused to create @seampact/pack-hal (429 Too Many Requests) after 1 new packages in this run and 0 " +
        "minutes of waiting: npm caps the new packages an account creates in a day. 2 left to publish " +
        "(@seampact/pack-hal, @seampact/spec); 1 published in this run stay, a rerun skips them: rerun publish-npm " +
        "in about 24 hours",
    );
    expect(pauses).toEqual([]);
    expect(calls).toEqual(["@seampact/cli", "@seampact/pack-hal"]);
  });

  it("stops by name once the total wait is spent", async () => {
    const plan = planOf(["@seampact/spec"], false);
    const pauses: number[] = [];
    const publishOne = scriptedPublish({ "@seampact/spec": Array(9).fill("rate-limited") }, []);

    await expect(publishInOrder(plan, publishOne, recordingWait(pauses))).rejects.toThrow(
      `npm still refuses @seampact/spec@${VERSION} (429 Too Many Requests) after 1 minutes of waiting. 1 left to ` +
        "publish (@seampact/spec); 0 published in this run stay, a rerun skips them: rerun publish-npm in an hour",
    );
    expect(pauses).toEqual([10, 20, 40, 30]);
  });

  it("reads Retry-After in seconds or as a date, and nothing else", () => {
    const now = Date.parse("2026-11-07T07:00:00Z");

    expect(retryAfterMilliseconds("120", now)).toBe(120_000);
    expect(retryAfterMilliseconds("Sat, 07 Nov 2026 07:01:00 GMT", now)).toBe(60_000);
    expect(retryAfterMilliseconds("soon", now)).toBeUndefined();
    expect(retryAfterMilliseconds(null, now)).toBeUndefined();
  });
});
