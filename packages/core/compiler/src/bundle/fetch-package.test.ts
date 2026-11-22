import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { temporaryDirectory } from "./bundle.test-support.js";
import { installedBundlePackage } from "./fetch-package.js";

test("a package name that climbs out of node_modules is not installed", () => {
  const root = temporaryDirectory();
  const project = join(root, "project");

  mkdirSync(join(project, "node_modules"), { recursive: true });
  mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "outside", "package.json"), '{"version":"9.9.9"}');

  const result = installedBundlePackage({ package: "../../outside", version: "9.9.9" }, project);

  expect(result).toMatchObject({ code: "bundle.package-missing" });
});

test("a scoped package name is found in node_modules", () => {
  const project = temporaryDirectory();
  const installed = join(project, "node_modules", "@acme", "notes");

  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "package.json"), '{"version":"1.0.0"}');

  const result = installedBundlePackage({ package: "@acme/notes", version: "1.0.0" }, project);

  expect(typeof result).toBe("string");
});
