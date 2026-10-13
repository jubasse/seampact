import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createDraftIR } from "./draft.js";
import { createDraftValidator, draftIrSchemas } from "./draft-schema.js";

const EVERY_MEMBER: unknown = JSON.parse(
  readFileSync(
    new URL("../../../spec/schemas/ir/examples/every-member.ir.json", import.meta.url),
    "utf8",
  ),
);

const validator = createDraftValidator();

const operationDraft = (operation: Record<string, unknown>) => ({
  ...createDraftIR(),
  operations: [operation],
});

// Every `required` list left in the documents, with where it sits.
function requiredLists(): { at: string; required: unknown }[] {
  const found: { at: string; required: unknown }[] = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value !== "object" || value === null) return;
    for (const [key, member] of Object.entries(value)) {
      if (key === "required" && Array.isArray(member)) found.push({ at, required: member });
      else visit(member, `${at}/${key}`);
    }
  };
  for (const document of draftIrSchemas()) visit(document, String(document.$id));
  return found;
}

describe("the derived draft form", () => {
  test("keeps no required member but each union variant's tag", () => {
    const lists = requiredLists();
    expect(lists.length).toBeGreaterThan(0);
    for (const { at, required } of lists) {
      expect(at, at).toMatch(/#?\/\$defs\/[A-Za-z0-9]+$/);
      expect(required, at).toHaveLength(1);
    }
    expect(lists).toContainEqual({
      at: expect.stringMatching(/\/\$defs\/IdentityAccess$/),
      required: ["kind"],
    });
  });

  test("accepts an empty draft, a partial one and a complete IR", () => {
    expect(validator.validate(createDraftIR()).valid).toBe(true);
    expect(validator.validate(operationDraft({ id: "getTask", method: "get" })).valid).toBe(true);
    expect(validator.validate(EVERY_MEMBER).valid).toBe(true);
  });

  test("refuses an unknown member, union tag or open-enum value, and a wrong type", () => {
    const unknownMember = validator.validate(operationDraft({ id: "getTask", later: true }));
    expect(unknownMember.unknownMembers).toEqual(["/operations/0/later"]);

    const unknownTag = validator.validate(operationDraft({ access: { kind: "zz-later" } }));
    expect(unknownTag.valid).toBe(false);
    expect(unknownTag.unknownKinds.map(({ value }) => value)).toEqual(["zz-later"]);

    const unknownValue = validator.validate(operationDraft({ method: "trace" }));
    expect(unknownValue.valid).toBe(false);
    expect(unknownValue.unknownValues.map(({ value }) => value)).toEqual(["trace"]);

    const wrongType = validator.validate(operationDraft({ safe: "yes" }));
    expect(wrongType.problems.map(({ pointer }) => pointer)).toEqual(["/operations/0/safe"]);
  });

  test("refuses a union element without its tag", () => {
    const report = validator.validate(operationDraft({ access: { identity: "user" } }));
    expect(report.valid).toBe(false);
  });
});
