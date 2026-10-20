import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { findLocalPackageSources } from "./local-packages.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function installed(app: string, name: string): void {
  const directory = join(app, "node_modules", name);

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
}

test("local sources refused on shared branches: findLocalPackageSources names local dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "seampact-local-packages-"));
  const app = join(root, "app");
  const linked = join(root, "linked-contract");

  temporaryDirectories.push(root);
  mkdirSync(linked, { recursive: true });
  writeFileSync(join(linked, "package.json"), JSON.stringify({ name: "linked", version: "1.0.0" }));
  installed(app, "file-contract");
  installed(app, "link-contract");
  installed(app, "registry-contract");
  symlinkSync(linked, join(app, "node_modules", "workspace-linked"), "junction");
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      dependencies: { "file-contract": "file:../contracts/file", "registry-contract": "1.0.0" },
      devDependencies: { "link-contract": "link:../contracts/link", "workspace-linked": "1.0.0" },
    }),
  );

  expect(
    findLocalPackageSources(app, [
      "file-contract",
      "link-contract",
      "registry-contract",
      "workspace-linked",
    ]),
  ).toEqual([
    { package: "file-contract", reason: { spec: "file:../contracts/file" } },
    { package: "link-contract", reason: { spec: "link:../contracts/link" } },
    { package: "workspace-linked", reason: { realPath: realpathSync(linked) } },
  ]);
});
