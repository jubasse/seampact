import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ignoreVendorDirectory } from "./ignore-vendor.ts";

const directories: string[] = [];

function app(gitignore: string | undefined): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-ignore-vendor-"));

  directories.push(directory);

  if (gitignore !== undefined) writeFileSync(join(directory, ".gitignore"), gitignore);

  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const ignoreOf = (directory: string): string => readFileSync(join(directory, ".gitignore"), "utf8");

test("vendor/ is added to a .gitignore that lacks it, and a missing one is created", () => {
  const existing = app("node_modules");
  const missing = app(undefined);

  ignoreVendorDirectory(existing);
  ignoreVendorDirectory(missing);

  expect(ignoreOf(existing)).toBe("node_modules\nvendor/\n");
  expect(ignoreOf(missing)).toBe("vendor/\n");
});

test("a .gitignore that already ignores vendor is left as it is", () => {
  const directory = app("dist\n/vendor\n");

  ignoreVendorDirectory(directory);

  expect(ignoreOf(directory)).toBe("dist\n/vendor\n");
});
