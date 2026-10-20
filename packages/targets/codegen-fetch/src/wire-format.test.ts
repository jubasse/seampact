import { readFileSync } from "node:fs";
import type { ContractIR, WireFormat } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { refuseFormatForms } from "./wire-format.js";

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

function goldenFormatWithListEnvelope(): WireFormat {
  const ir: ContractIR = JSON.parse(
    readFileSync(new URL("fixtures/golden/reference/tasks.ir.json", REPOSITORY_ROOT), "utf8"),
  );
  const [format] = Object.values(ir.formats);

  if (format === undefined) throw new Error("the golden tasks IR declares no format");

  return {
    ...format,
    success: {
      ...format.success,
      list: { ...format.success.list, body: { kind: "slot", path: ["data"], slot: "payload" } },
    },
  };
}

describe("refuseFormatForms", () => {
  test("a list envelope is ignored when no list operation uses the format", () => {
    expect(refuseFormatForms(goldenFormatWithListEnvelope(), false)).toEqual([]);
  });

  test("a list envelope is refused when a list operation uses the format", () => {
    const refusals = refuseFormatForms(goldenFormatWithListEnvelope(), true);

    expect(refusals.map((refusal) => refusal.code)).toEqual([
      "format.success.envelope.unsupported",
    ]);
  });
});
