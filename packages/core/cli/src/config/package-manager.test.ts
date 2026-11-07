import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { findPackageManager, installCommand, installFix } from "./package-manager.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seampact-pm-"));

  directories.push(root);

  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);

  return root;
}

test.each([
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
])("a %s names %s", (lockfile, manager) => {
  expect(findPackageManager(project({ [lockfile]: "" }))).toBe(manager);
});

test("the packageManager field names the manager when there is no lockfile", () => {
  const root = project({ "package.json": '{ "packageManager": "yarn@4.1.0" }' });

  expect(findPackageManager(root)).toBe("yarn");
});

test("a lockfile wins over the packageManager field of the same directory", () => {
  const root = project({
    "pnpm-lock.yaml": "",
    "package.json": '{ "packageManager": "yarn@4.1.0" }',
  });

  expect(findPackageManager(root)).toBe("pnpm");
});

test("a packageManager field naming no known manager is ignored", () => {
  const root = project({ "package.json": '{ "packageManager": "deno@1.0.0" }' });
  const nested = join(root, "app");

  mkdirSync(nested);
  writeFileSync(join(root, "pnpm-lock.yaml"), "");

  expect(findPackageManager(nested)).toBe("pnpm");
});

test("the nearest directory with a lockfile wins over one further up", () => {
  const root = project({ "yarn.lock": "" });
  const nested = join(root, "app");

  mkdirSync(nested);
  writeFileSync(join(nested, "package-lock.json"), "");

  expect(findPackageManager(nested)).toBe("npm");
});

test("a dev dependency and a runtime dependency use their own command", () => {
  const root = project({ "pnpm-lock.yaml": "" });

  expect(installCommand(root, "@seampact/codegen-zod", "dev")).toBe(
    "pnpm add -D @seampact/codegen-zod",
  );
  expect(installCommand(root, "zod", "runtime")).toBe("pnpm add zod");
});

test("the install fix says why no command can be told when a package.json above is not JSON", () => {
  const root = project({ "package.json": "{ not json" });

  const fix = installFix(root, "zod", "runtime");

  expect(fix).toContain("with your package manager");
  expect(fix).toContain("is not valid JSON");
});

test("the install fix names the command otherwise", () => {
  expect(installFix(project({ "bun.lock": "" }), "zod", "runtime")).toBe(
    "Install it: `bun add zod`.",
  );
});
