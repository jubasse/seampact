import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { RECORD_DIRECTORY_VARIABLE } from "./record-environment.ts";

// Vitest setup of the recording run: every call of `emitDocuments` and `diffContracts` a test makes is appended, with
// its arguments and the test that made it, to a file of the directory `RECORD_DIRECTORY_VARIABLE` names.

function note(kind: "openapi" | "diff", payload: object): void {
  const directory = process.env[RECORD_DIRECTORY_VARIABLE];

  if (directory === undefined) throw new Error(`${RECORD_DIRECTORY_VARIABLE} is not set`);

  const { testPath, currentTestName } = expect.getState();

  appendFileSync(
    join(directory, `${process.pid}.jsonl`),
    `${JSON.stringify({ kind, testPath, testName: currentTestName, ...payload })}\n`,
  );
}

type Wrapped = (...args: unknown[]) => unknown;

vi.mock("../../packages/core/openapi/src/documents.ts", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const emitDocuments = original.emitDocuments as Wrapped;

  return {
    ...original,
    emitDocuments: (ir: unknown, options?: unknown) => {
      note("openapi", { ir, options });

      return emitDocuments(ir, options);
    },
  };
});

vi.mock("../../packages/core/diff/src/diff-contracts.ts", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const diffContracts = original.diffContracts as Wrapped;

  return {
    ...original,
    diffContracts: (before: unknown, after: unknown, options: unknown) => {
      note("diff", { before, after, options });

      return diffContracts(before, after, options);
    },
  };
});
