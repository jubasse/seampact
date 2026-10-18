import { describe, expect, test } from "vitest";
import {
  deriveWireLocated,
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
      [BODY_LIMIT, `${BODY_LIMIT}  int64: string\n  urls: relative\n`],
    ]);
    const run = deriveWireRunContract(variant, "tasks");

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.api?.wire).toEqual({ int64: "string", outputEnums: "enum", urls: "relative" });
  });

  test("a wire convention other than the default is refused at its key", () => {
    const variant = deriveWireReferenceVariant("shared/base.yaml", [
      [BODY_LIMIT, `${BODY_LIMIT}  int64: number\n  outputEnums: open\n  urls: absolute\n`],
    ]);
    const run = deriveWireRunContract(variant, "tasks");

    expect(run.diagnostics.map(deriveWireLocated)).toEqual(
      ["int64", "outputEnums", "urls"].map((key) => ({
        rule: "seampact/derive/wire-convention-unsupported",
        pointer: `/conventions/${key}`,
        related: [],
      })),
    );
    expect(run.diagnostics[0]?.message).toBe(
      "The convention int64 is 'number'; the compiler writes only 'string' so far.",
    );
  });
});
