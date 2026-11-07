// Test helper: loads a fixture directory and compares the printed diagnostics with expected.txt.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { printDiagnostics } from "../diagnostics/print.js";
import { type LoadResult, loadFsReader, loadWorkspace } from "./index.js";

export const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../fixtures/loader",
);

export function loadFixture(dir: string, entry?: string): LoadResult {
  const root = join(FIXTURES, dir);
  const chosen =
    entry ?? (existsSync(join(root, "workspace.yaml")) ? "workspace.yaml" : "api.yaml");

  return loadWorkspace({ reader: loadFsReader(root), entry: chosen });
}

export function expectGolden(dir: string, result: LoadResult): string {
  const printed = printDiagnostics(result.diagnostics, result.workspace.locations);
  const file = join(FIXTURES, dir, "expected.txt");

  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, `${printed}\n`);
  expect(readFileSync(file, "utf8")).toBe(`${printed}\n`);

  return printed;
}

export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");

  return value;
}
