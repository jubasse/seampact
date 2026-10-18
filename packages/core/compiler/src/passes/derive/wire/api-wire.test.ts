import { describe, expect, test } from "vitest";
import {
  deriveWireReferenceVariant,
  deriveWireReferenceWorkspace,
  deriveWireRunContract,
  deriveWireRunReference,
} from "./test-support.js";

const BODY_LIMIT = "  bodyLimit: 1MiB\n";

describe("derive.wire writes api.wire", () => {
  test("derive.wire writes the default api wire", () => {
    const run = deriveWireRunReference(deriveWireReferenceWorkspace(), "tasks");

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.api?.wire).toEqual({ int64: "string", outputEnums: "enum", urls: "relative" });
  });

  test("a written default is accepted", () => {
    const variant = deriveWireReferenceVariant("shared/base.yaml", [
      [BODY_LIMIT, `${BODY_LIMIT}  int64: string\n  outputEnums: enum\n  urls: relative\n`],
    ]);
    const run = deriveWireRunContract(variant, "tasks");

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.api?.wire).toEqual({ int64: "string", outputEnums: "enum", urls: "relative" });
  });

  test("typed convention members: a value other than the default is written", () => {
    const variant = deriveWireReferenceVariant("shared/base.yaml", [
      [BODY_LIMIT, `${BODY_LIMIT}  int64: number\n  outputEnums: open\n  urls: absolute\n`],
    ]);
    const run = deriveWireRunContract(variant, "tasks");

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.api?.wire).toEqual({ int64: "number", outputEnums: "open", urls: "absolute" });
  });
});
