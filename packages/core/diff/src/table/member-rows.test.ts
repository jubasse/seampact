import { IR_SCHEMA_DOCUMENTS, SOURCE_MAP_SCHEMA_ID, type SchemaNode } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { MEMBER_ROWS } from "./member-rows.js";

// Every object member of the IR schema files has a row, so an IR change fails here until it adds one.

const ROOT_DEFINITION = "ContractIR";

/** `<Definition>.<member>` for every object member of the documents. */
function irMembers(documents: readonly SchemaNode[]): string[] {
  return documents
    .filter((document) => document.$id !== SOURCE_MAP_SCHEMA_ID)
    .flatMap((document) => {
      const root: [string, unknown][] =
        document.properties === undefined ? [] : [[ROOT_DEFINITION, document]];

      return [...root, ...entriesOf(document.$defs)].flatMap(([name, definition]) =>
        entriesOf(definition)
          .filter(([keyword]) => keyword === "properties")
          .flatMap(([, properties]) =>
            entriesOf(properties).map(([member]) => `${name}.${member}`),
          ),
      );
    });
}

function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}

function membersWithoutRow(documents: readonly SchemaNode[]): string[] {
  return irMembers(documents).filter((member) => {
    const [definition = "", name = ""] = member.split(".");

    return MEMBER_ROWS[definition]?.[name] === undefined;
  });
}

describe("the member table", () => {
  test("every IR member has a row", () => {
    expect(membersWithoutRow(IR_SCHEMA_DOCUMENTS)).toEqual([]);
  });

  test("every row names an IR member", () => {
    const members = new Set(irMembers(IR_SCHEMA_DOCUMENTS));
    const rows = Object.entries(MEMBER_ROWS).flatMap(([definition, rowsOf]) =>
      Object.keys(rowsOf).map((member) => `${definition}.${member}`),
    );

    expect(rows.filter((row) => !members.has(row))).toEqual([]);
  });

  test("an IR schema member with no row fails the coverage test", () => {
    const changed: SchemaNode = {
      $id: "https://seampact.dev/schemas/ir/test.schema.json",
      $defs: { Property: { properties: { name: {}, weight: {} } } },
    };

    expect(membersWithoutRow([changed])).toEqual(["Property.weight"]);
  });
});
