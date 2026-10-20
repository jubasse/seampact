import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { Template, WireFormat } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { refuseFormatForms } from "./wire-format.js";

// `conventions.errors.requireCode: false` lets a contract write an error body with no code; the client reads the
// code, so it refuses that format by name until it models one.

test("an error format that writes no code is refused by name", () => {
  const [format] = Object.values(readGoldenIr("tasks").formats);

  if (format === undefined) throw new Error("the tasks contract declares no format");

  const body: Template = { kind: "object", members: [] };
  const codeless: WireFormat = { ...format, error: { ...format.error, body } };

  expect(refuseFormatForms(codeless).map((refusal) => refusal.code)).toContain(
    "format.error.body.unsupported",
  );
});
