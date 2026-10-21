import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkTarballContents } from "./tarball-check.ts";

function tarballWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bench-tarball-"));
  const packageDirectory = join(root, "package");

  mkdirSync(join(packageDirectory, "dist"), { recursive: true });

  for (const [name, content] of Object.entries(files))
    writeFileSync(join(packageDirectory, name), content);

  const tarball = join(root, "pack.tgz");

  execFileSync("tar", ["czf", tarball, "-C", root, "package"]);

  return tarball;
}

const MANIFEST = JSON.stringify({ name: "@seampact/demo", main: "./dist/index.js" });

describe("checkTarballContents", () => {
  test("accepts a package with its entry file", () => {
    expect(() =>
      checkTarballContents(tarballWith({ "package.json": MANIFEST, "dist/index.js": "" })),
    ).not.toThrow();
  });

  test("refuses a package without dist, naming it", () => {
    const empty = mkdtempSync(join(tmpdir(), "bench-tarball-"));

    mkdirSync(join(empty, "package"));
    writeFileSync(join(empty, "package/package.json"), MANIFEST);
    execFileSync("tar", ["czf", join(empty, "p.tgz"), "-C", empty, "package"]);

    expect(() => checkTarballContents(join(empty, "p.tgz"))).toThrow("@seampact/demo");
  });

  test("accepts a data package whose files list no dist", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-tarball-"));
    const manifest = { name: "@seampact/pack-demo", files: ["pack.yaml"] };

    mkdirSync(join(root, "package"));
    writeFileSync(join(root, "package/package.json"), JSON.stringify(manifest));
    writeFileSync(join(root, "package/pack.yaml"), "");
    execFileSync("tar", ["czf", join(root, "p.tgz"), "-C", root, "package"]);

    expect(() => checkTarballContents(join(root, "p.tgz"))).not.toThrow();
  });

  test("refuses a package without its declared entry file", () => {
    expect(() =>
      checkTarballContents(tarballWith({ "package.json": MANIFEST, "dist/other.js": "" })),
    ).toThrow("lacks its main");
  });
});
