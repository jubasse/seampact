import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { loadFsReader } from "../load/index.js";
import { type BundleBuildOptions, buildBundle } from "./build.js";
import type { BundleContents } from "./contents.js";

// What the bundle tests share: the reference contract's bundle, and temporary directories removed after each test.

export const REFERENCE = fileURLToPath(
  new URL("../../../../../fixtures/reference", import.meta.url),
);
export const GOLDEN_REFERENCE = fileURLToPath(
  new URL("../../../../../fixtures/golden/reference", import.meta.url),
);
export const REFERENCE_CONTRACT = {
  name: "@seampact-fixtures/reference",
  version: "1.0.0",
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** A new empty directory, removed after the test. */
export function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-bundle-test-"));

  temporaryDirectories.push(directory);

  return directory;
}

export function referenceBuildOptions(): BundleBuildOptions {
  return { reader: loadFsReader(REFERENCE), entry: "workspace.yaml", contract: REFERENCE_CONTRACT };
}

/** The bundle of `options`, failing the test when it cannot be made. */
export function builtContents(options: BundleBuildOptions): BundleContents {
  const built = buildBundle(options);

  if (!built.ok) throw new Error(`the bundle was refused: ${JSON.stringify(built.failures)}`);

  return built.contents;
}

/** A one-api contract applying an npm pack, for a memory reader. */
export const PACK_CONTRACT = {
  "package.json": JSON.stringify({ name: "@acme/contract", version: "3.1.0" }),
  "api.yaml": "api: { name: t, version: 1 }\npacks: ['@acme/pack-a']\n",
  "node_modules/@acme/pack-a/package.json": JSON.stringify({
    name: "@acme/pack-a",
    version: "1.2.0",
    seampact: { role: "pack", pack: "lib/pack.yaml" },
  }),
  "node_modules/@acme/pack-a/lib/pack.yaml":
    "pack: { name: '@acme/pack-a', version: 1.2.0 }\nrights:\n  r.one: {}\nconventions:\n  paging: { default: cursor }\n",
};
