import { readFileSync } from "node:fs";
import { type ContractIR, IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import { expect, test } from "vitest";
import { defineTarget } from "./define-target.js";
import type { GeneratedFile } from "./target.js";

const PACKAGE_NAME = "@seampact/codegen-stub";
const PACKAGE_VERSION = "1.2.3";

const validIr: ContractIR = JSON.parse(
  readFileSync(
    new URL("../../spec/schemas/ir/examples/every-member.ir.json", import.meta.url),
    "utf8",
  ),
);

function stubTarget() {
  const calls = { generate: 0 };

  const target = defineTarget<object, "types">({
    metadata: {
      packageName: PACKAGE_NAME,
      packageVersion: PACKAGE_VERSION,
      role: "provider",
      irSupport: {
        irVersions: [IR_VERSION],
        irRevision: IR_REVISION,
        kinds: ["httpOperation"],
        features: [],
      },
      artefacts: [{ id: "types", defaultOn: true }],
      consumes: {},
      provides: {},
    },
    format,
    parseOptions: () => ({ status: "parsed", options: {} }),
    generate: () => {
      calls.generate += 1;
      const file: GeneratedFile = { path: "types.ts", contents: "export type Id = string" };

      return { status: "generated", files: [file] };
    },
  });

  return { target, calls };
}

function withOperationFeature(feature: string): ContractIR {
  const [first, ...rest] = validIr.operations;

  if (first === undefined) throw new Error("every-member.ir.json has no operation");

  return { ...validIr, operations: [{ ...first, features: [feature] }, ...rest] };
}

const unsupportedIrCases: {
  name: string;
  ir: ContractIR;
  code: string;
  value: string;
  expected: string;
}[] = [
  {
    name: "another irVersion",
    ir: { ...validIr, irVersion: IR_VERSION + 1 },
    code: "ir.version.unsupported",
    value: String(IR_VERSION + 1),
    expected: String(IR_VERSION),
  },
  {
    name: "another irRevision",
    ir: { ...validIr, irRevision: IR_REVISION + 1 },
    code: "ir.revision.mismatch",
    value: String(IR_REVISION + 1),
    expected: String(IR_REVISION),
  },
  {
    name: "an unknown kind",
    ir: { ...validIr, kinds: ["httpOperation", "eventChannel"] },
    code: "ir.kind.unsupported",
    value: "eventChannel",
    expected: "httpOperation",
  },
  {
    name: "an unknown top-level feature",
    ir: { ...validIr, features: ["streaming"] },
    code: "ir.feature.unsupported",
    value: "streaming",
    expected: "expects none",
  },
  {
    name: "an unknown operation feature",
    ir: withOperationFeature("streaming"),
    code: "ir.feature.unsupported",
    value: "streaming",
    expected: "expects none",
  },
];

test.each(unsupportedIrCases)(
  "refuses an IR the target was not built for: $name",
  async (irCase) => {
    const { target, calls } = stubTarget();

    const outcome = await target.generate({
      ir: irCase.ir,
      options: {},
      links: {},
      artefacts: new Set(["types"]),
    });

    expect(outcome.status).toBe("refused");
    expect(calls.generate).toBe(0);

    if (outcome.status !== "refused") return;

    const [refusal] = outcome.refusals;

    expect(refusal?.code).toBe(irCase.code);
    expect(refusal?.message).toContain(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
    expect(refusal?.message).toContain(`The IR has ${irCase.value}`);
    expect(refusal?.message).toContain(irCase.expected);
    expect(refusal?.fix).toContain(`Update ${PACKAGE_NAME}`);
  },
);
