import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packedTarballs, publishPlan, type Tarball } from "./publish-npm.ts";

const VERSION = "1.2.3";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const LOOPBACK = "127.0.0.1";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

// A directory of `pnpm pack`-shaped tarballs, one per package name.
function tarballDirectory(names: readonly string[]): Tarball[] {
  const directory = mkdtempSync(join(tmpdir(), "release-publish-"));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  for (const name of names) {
    const tree = join(directory, name.replace("/", "-"));

    mkdirSync(join(tree, "package"), { recursive: true });
    writeFileSync(
      join(tree, "package", "package.json"),
      JSON.stringify({ name, version: VERSION }),
    );
    execFileSync("tar", [
      "-czf",
      join(directory, `${name.slice(1).replace("/", "-")}-${VERSION}.tgz`),
      "-C",
      tree,
      "package",
    ]);
  }

  return packedTarballs(directory);
}

// A registry serving the given packuments by URL path, and 404 for every other package.
async function registry(packumentByPath: ReadonlyMap<string, unknown>): Promise<string> {
  const server: Server = createServer((request, response) => {
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

describe("the idempotent npm publish", () => {
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
    expect(plan.toPublish.map((tarball) => tarball.name)).toEqual([
      "@seampact/pack-hal",
      "@seampact/spec",
    ]);
  });

  it("fails by name, before publishing anything, on a version held with other bytes", async () => {
    const tarballs = tarballDirectory(["@seampact/cli", "@seampact/spec"]);
    const url = await registry(new Map([["/@seampact%2fspec", packumentOf("sha512-other")]]));

    await expect(publishPlan(url, tarballs)).rejects.toThrow(
      new RegExp(
        `^@seampact/spec@${VERSION} is on .* with other bytes .*: a published version never changes, so nothing was published`,
      ),
    );
  });

  it("reads the integrity npm stores, the SHA-512 of the tarball's bytes", () => {
    const [cli] = tarballDirectory(["@seampact/cli"]);

    expect(cli).toMatchObject({ name: "@seampact/cli", version: VERSION });
    expect(cli?.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
  });
});
