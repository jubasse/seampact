import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { checkIrSupport, type IrSupport, type IrSupportInput } from "./support.js";
import { validateIr } from "./test-support.js";
import { IR_REVISION, IR_VERSION } from "./version.js";

const sample = (name: string): IrSupportInput =>
  JSON.parse(readFileSync(new URL(`../../schemas/ir/examples/${name}`, import.meta.url), "utf8"));

const READER: IrSupport = {
  irVersions: [IR_VERSION],
  irRevision: IR_REVISION,
  kinds: ["httpOperation"],
  features: [],
};

describe("checkIrSupport", () => {
  test("accepts what the reader supports, whatever unknown members the IR holds", () => {
    expect(checkIrSupport(sample("every-member.ir.json"), READER)).toEqual([]);
    expect(checkIrSupport(sample("unknown-member.ir.json"), READER)).toEqual([]);
    expect(checkIrSupport(sample("unknown-enum-value.ir.json"), READER)).toEqual([]);
  });

  test("checkIrSupport names the mismatch", () => {
    const ir = { ...sample("unknown-kind-and-feature.ir.json"), irRevision: 8 };

    expect(validateIr(ir, "open").valid).toBe(true);
    expect(checkIrSupport(ir, { ...READER, irRevision: 7 })).toEqual([
      {
        code: "ir.revision.mismatch",
        member: "/irRevision",
        value: 8,
        expected: [7],
        message: "irRevision 8 differs from the revision this reader was built for (7).",
      },
      {
        code: "ir.kind.unsupported",
        member: "/kinds/1",
        value: "channel",
        expected: ["httpOperation"],
        message: "The declaration kind 'channel' is not supported by this reader.",
      },
      {
        code: "ir.feature.unsupported",
        member: "/features/0",
        value: "streaming",
        expected: [],
        message: "The feature 'streaming' is not supported by this reader.",
      },
      {
        code: "ir.feature.unsupported",
        member: "/operations/0/features/0",
        value: "streaming",
        expected: [],
        operation: "health",
        message: "The feature 'streaming' in operation 'health' is not supported by this reader.",
      },
    ]);
  });

  test("an unsupported irVersion is named alone, whatever shape the rest has", () => {
    const version = {
      code: "ir.version.unsupported",
      member: "/irVersion",
      value: 2,
      expected: [1],
      message: "irVersion 2 is not one this reader reads (1).",
    };

    expect(checkIrSupport({ irVersion: 2, operations: {}, kinds: "all" }, READER)).toEqual([
      version,
    ]);
    expect(checkIrSupport(null, READER)).toEqual([
      {
        ...version,
        value: "missing",
        message: "irVersion missing is not one this reader reads (1).",
      },
    ]);
  });

  test("a missing or non-array list is malformed, never read as empty", () => {
    const ir = sample("every-member.ir.json") as unknown as Record<string, unknown>;
    const { kinds: _kinds, ...withoutKinds } = ir;
    const operations = [{ id: "health", kind: "httpOperation", features: "none" }];

    expect(checkIrSupport({ ...withoutKinds, features: {}, operations }, READER)).toEqual([
      expect.objectContaining({ code: "ir.support.malformed", member: "/kinds", value: "missing" }),
      expect.objectContaining({
        code: "ir.support.malformed",
        member: "/features",
        value: "object",
      }),
      expect.objectContaining({
        code: "ir.support.malformed",
        member: "/operations/0/features",
        value: "string",
        operation: "health",
      }),
    ]);
    expect(checkIrSupport({ ...ir, operations: { health: {} } }, READER)).toEqual([
      expect.objectContaining({ code: "ir.support.malformed", member: "/operations" }),
    ]);
  });

  test("names an unknown operation kind with the operation (SCN-092)", () => {
    const ir = sample("every-member.ir.json");
    const operations = ir.operations.map((operation) =>
      operation.id === "health" ? { ...operation, kind: "rpcMethod" } : operation,
    );

    expect(
      checkIrSupport({ ...ir, kinds: ["httpOperation", "rpcMethod"], operations }, READER),
    ).toEqual([
      expect.objectContaining({
        code: "ir.kind.unsupported",
        member: "/kinds/1",
        value: "rpcMethod",
      }),
      expect.objectContaining({
        code: "ir.kind.unsupported",
        member: "/operations/1/kind",
        value: "rpcMethod",
        operation: "health",
      }),
    ]);
  });
});
