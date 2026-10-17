import { describe, expect, test } from "vitest";
import type { DraftIR } from "../../../pipeline/seam.js";
import {
  accessRightsFieldsPaging,
  accessRightsListPaging,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// A list of items whose `cost` is restricted, and whose `grade` is restricted with params; each test writes the
// list's `sortable` and `filteredBy`.
const contract = (list: string): string => `api: { name: shop, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  clerk: { schemes: { read: [bearer], write: [bearer] }, principal: Clerk }
schemas:
  ItemId: { type: string, format: uuid }
  Clerk: { type: object, required: [clerkId], properties: { clerkId: { type: string } } }
  Item:
    type: object
    required: [itemId, name]
    properties:
      itemId: ItemId
      name: { type: string }
      cost: { type: integer, restrictedTo: items.cost }
      grade: { type: integer, restrictedTo: { right: items.grade, params: { level: high } } }
pagings:
  offset:
    request:
      offset: { query: offset }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
rights:
  items.cost: {}
  items.grade: { params: { level: { type: string } } }
  items.read: {}
  items.audit: {}
surfaces:
  app:
    prefix: /v{version}
    identity: clerk
    routes:
      items:
        kind: collection
        id: { itemId: ItemId }
        item: Item
        ops:
          list:
            paging: offset
${list}`;

const SORTABLE = "/surfaces/app/routes/items/ops/list/sortable";

const run = (list: string, keys: readonly string[]) =>
  accessRightsRunContract(accessRightsLoadFiles({ "api.yaml": contract(list) }), (draft) =>
    accessRightsListPaging(draft, { operation: "listItems", sortable: SORTABLE, keys }),
  );

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule.replace("seampact/access/", ""), origin.pointer]);

const listOf = (draft: DraftIR) =>
  draft.operations.find((operation) => operation.id === "listItems");

describe("sort-key rights", () => {
  test("a key inherits its field's right with sortKey.restricted, or states its own, on the fields fixture", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFixture("fields"),
      accessRightsFieldsPaging,
    );
    const list = draft.operations.find((operation) => operation.id === "listNotes");

    expect(diagnostics).toEqual([]);
    expect(
      list?.paging?.sortKeys.map(({ key, right, derivedFrom }) => [key, right, derivedFrom]),
    ).toEqual([
      ["title", undefined, undefined],
      [
        "cost",
        "notes.seeCost",
        {
          derivation: "sortKey.restricted",
          from: [{ layer: "api", pointer: "/schemas/Note/properties/cost/restrictedTo" }],
        },
      ],
      [
        "memo",
        "notes.annotate",
        {
          derivation: "sortKey.restricted",
          from: [{ layer: "api", pointer: "/schemas/Note/properties/memo/restrictedTo" }],
        },
      ],
    ]);
  });

  test("a key of an unrestricted field states its right, with no derivation", () => {
    const { draft, diagnostics } = run(
      "            sortable: [{ key: name, right: items.audit }]\n",
      ["name"],
    );

    expect(diagnostics).toEqual([]);
    expect(listOf(draft)?.paging?.sortKeys).toEqual([
      {
        key: "name",
        right: "items.audit",
        origin: { layer: "api", pointer: `${SORTABLE}/0` },
      },
    ]);
  });

  test("a stated right that disagrees with the field's, an undeclared one, or one inherited with params, is an error", () => {
    const { draft, diagnostics } = run(
      "            sortable: [{ key: cost, right: items.audit }, { key: name, right: items.ghost }, grade]\n",
      ["cost", "name", "grade"],
    );

    expect(located(diagnostics)).toEqual([
      ["sort-key-right", `${SORTABLE}/0/right`],
      ["sort-key-right", `${SORTABLE}/1/right`],
      ["sort-key-right", `${SORTABLE}/2`],
    ]);
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "sort key 'cost' of route 'listItems' is given right 'items.audit', but its field is restricted to 'items.cost'",
      "sort key 'name' is given right 'items.ghost', which the rights catalogue does not declare",
      "sort key 'grade' of route 'listItems' inherits right 'items.grade' with params from its field, and a sort key's right carries no params",
    ]);
    expect(diagnostics[0]?.related.map(({ origin }) => origin.pointer)).toEqual([
      "/schemas/Item/properties/cost/restrictedTo",
    ]);
    expect(listOf(draft)?.paging?.sortKeys.map(({ right }) => right)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("filteredBy", () => {
  test("a list's filteredBy names a declared right, written as is", () => {
    const { draft, diagnostics } = run("            filteredBy: items.read\n", []);

    expect(diagnostics).toEqual([]);
    expect(listOf(draft)?.filteredBy).toBe("items.read");
  });

  test("a filteredBy naming an undeclared right is an error and is not written", () => {
    const { draft, diagnostics } = run("            filteredBy: items.ghost\n", []);

    expect(located(diagnostics)).toEqual([
      ["filtered-by", "/surfaces/app/routes/items/ops/list/filteredBy"],
    ]);
    expect(listOf(draft)?.filteredBy).toBeUndefined();
  });
});
