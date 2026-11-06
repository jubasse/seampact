import { refuseFormatForms } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { Template, WireFormat } from "@seampact/spec/ir";
import { expect, test } from "vitest";

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

test("an error format that writes the code only inside a text template is refused by name", () => {
  const [format] = Object.values(readGoldenIr("tasks").formats);

  if (format === undefined) throw new Error("the tasks contract declares no format");

  const body: Template = {
    kind: "object",
    members: [
      {
        name: { kind: "text", text: "type" },
        value: {
          kind: "text",
          parts: [
            { kind: "text", text: "https://api.example.com/errors/" },
            { kind: "slot", slot: "code", path: [] },
          ],
        },
      },
    ],
  };
  const templated: WireFormat = { ...format, error: { ...format.error, body } };

  expect(refuseFormatForms(templated).map((refusal) => refusal.code)).toContain(
    "format.error.body.unsupported",
  );
});
