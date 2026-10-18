import { describe, expect, test } from "vitest";
import type { JsonValue } from "../raw-tree.js";
import {
  type TemplateFault,
  type TemplateSlot,
  templateRead,
  templateSlots,
  templateUses,
} from "./index.js";

const PLACE_SLOTS: readonly TemplateSlot[] = [
  { name: "code", kind: "value" },
  { name: "params", kind: "object" },
  { name: "list", kind: "array" },
];
const ELEMENT_SLOTS: readonly TemplateSlot[] = [{ name: "item", kind: "value" }];

function read(value: JsonValue, slots: readonly TemplateSlot[] = PLACE_SLOTS) {
  const faults: TemplateFault[] = [];
  const template = templateRead(
    {
      slots,
      eachSlots: ELEMENT_SLOTS,
      owner: "the role notFound",
      placeName: "a role binding",
      report: (fault) => faults.push(fault),
    },
    value,
    "/t",
  );

  return { template, faults: faults.map(({ rule, pointer }) => ({ rule, pointer })), all: faults };
}

describe("templateRead", () => {
  test("reads slots, text parts, member names, merges and arrays of the caller's slots", () => {
    const { template, faults } = read({
      $merge: "$params",
      title: `Missing \${code.name} ($$5)`,
      $$raw: "$code",
      rows: { $each: "$list", $as: ["$item", 3] },
    });

    expect(faults).toEqual([]);
    expect(template).toEqual({
      kind: "object",
      merge: "params",
      members: [
        {
          name: { kind: "text", text: "title" },
          value: {
            kind: "text",
            parts: [
              { kind: "text", text: "Missing " },
              { kind: "slot", slot: "code", path: ["name"] },
              { kind: "text", text: " ($5)" },
            ],
          },
        },
        { name: { kind: "text", text: "$raw" }, value: { kind: "slot", slot: "code", path: [] } },
        {
          name: { kind: "text", text: "rows" },
          value: {
            kind: "each",
            of: "list",
            as: {
              kind: "array",
              items: [
                { kind: "slot", slot: "item", path: [] },
                { kind: "literal", value: 3 },
              ],
            },
          },
        },
      ],
    });
    expect(
      templateSlots(template ?? { kind: "literal", value: null }).map(({ slot }) => slot),
    ).toEqual(["params", "code", "code", "list", "item"]);
    expect(template !== undefined && templateUses(template, "list")).toBe(true);
  });

  test("reads a value that is no text, array or object as a literal", () => {
    expect(read(null).template).toEqual({ kind: "literal", value: null });
    expect(read(true).template).toEqual({ kind: "literal", value: true });
  });

  test("refuses a slot the place does not fill, and an element slot outside $as", () => {
    const { template, faults, all } = read({ a: "$nature", b: `\${item}` });

    expect(template).toBeUndefined();
    expect(faults).toEqual([
      { rule: "template-slot", pointer: "/t/a" },
      { rule: "template-slot", pointer: "/t/b" },
    ]);
    expect(all[0]?.message).toBe(
      "The template of the role notFound writes the slot $nature, which a role binding does not fill.",
    );
  });

  test("refuses the syntax faults where they are written", () => {
    const { faults } = read({
      a: "costs $5",
      $9: "x",
      b: { $each: "$list" },
      $merge: "$params.name",
    });

    expect(faults).toEqual([
      { rule: "template-syntax", pointer: "/t/a" },
      { rule: "template-syntax", pointer: "/t/$9" },
      { rule: "template-syntax", pointer: "/t/b" },
      { rule: "template-syntax", pointer: "/t/$merge" },
    ]);
  });

  test("refuses a slot whose kind does not fit where it stands, naming the slots that fit", () => {
    const { faults, all } = read({ $merge: "$code", a: { $each: "$params", $as: "$item" } });

    expect(faults).toEqual([
      { rule: "template-merge", pointer: "/t/$merge" },
      { rule: "template-each", pointer: "/t/a/$each" },
    ]);
    expect(all.map(({ fix }) => fix)).toEqual([
      "Merge an object slot ($params), or write the slot as a member.",
      "Map an array slot ($list), or write the slot as a member.",
    ]);
  });

  test("says so when no slot of the place fits the stand", () => {
    const { faults, all } = read({ $code: 1 });

    expect(faults).toEqual([{ rule: "template-name", pointer: "/t/$code" }]);
    expect(all[0]?.fix).toBe(
      "Write $code as a member: a role binding fills no slot that holds a name.",
    );
    expect(read({ $name: 1 }, [{ name: "name", kind: "name" }]).faults).toEqual([]);
  });
});
