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
  ChildId: { type: string, format: uuid }
  Clerk: { type: object, required: [clerkId], properties: { clerkId: { type: string } } }
  Item:
    type: object
    required: [itemId, name]
    properties:
      itemId: ItemId
      name: { type: string }
      cost: { type: integer, restrictedTo: items.cost }
      grade: { type: integer, restrictedTo: { right: items.grade, params: { level: high } } }
      margin: { type: integer, restrictedTo: items.margin }
  EvA:
    type: object
    properties: { cost: { type: integer, restrictedTo: items.cost }, name: { type: string } }
  EvB:
    type: object
    properties: { cost: { type: integer, restrictedTo: items.audit }, name: { type: string } }
  EvC:
    type: object
    properties: { cost: { type: integer }, name: { type: string } }
  Mixed:
    discriminator: kind
    oneOf: { a: EvA, b: EvB }
  Shared:
    discriminator: kind
    oneOf: { a: EvA, c: EvC }
  Child:
    type: object
    required: [childId, itemId]
    properties:
      childId: ChildId
      itemId: ItemId
      margin: { type: integer, restrictedTo: items.margin }
  Tally:
    type: object
    additionalProperties: { type: integer }
pagings:
  offset:
    request:
      offset: { query: offset }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
conventions:
  paging: { maxLimit: 50 }
rights:
  items.cost: {}
  items.grade: { params: { level: { type: string } } }
  items.read: {}
  items.audit: {}
  items.margin: { subject: { resource: Item, id: ItemId } }
  shop.staff: { subject: { scope: shop } }
scopes:
  shop: { id: { type: string, format: uuid } }
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
        "rating",
        "notes.read",
        {
          derivation: "sortKey.restricted",
          from: [{ layer: "api", pointer: "/schemas/Note/properties/rating/restrictedTo" }],
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

describe("sort-key subjects", () => {
  test("a key whose resource or scope right has no subject on the list route is an error naming the key, the right and the route", () => {
    const { draft, diagnostics } = run(
      "            sortable: [margin, { key: name, right: shop.staff }]\n",
      ["margin", "name"],
    );

    expect(located(diagnostics)).toEqual([
      ["sort-key-right", `${SORTABLE}/0`],
      ["sort-key-right", `${SORTABLE}/1`],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "sort key 'margin' of route 'listItems' has right 'items.margin', whose subject the route does not resolve",
    );
    expect(listOf(draft)?.paging?.sortKeys.map(({ right }) => right)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

// A second list below the contract's `items` list, run with tree.nodes' own paging.
const runBeside = (routes: string) =>
  accessRightsRunContract(
    accessRightsLoadFiles({ "api.yaml": contract(`            sortable: [name]\n${routes}`) }),
  );

const sortKeysOf = (draft: DraftIR, id: string) =>
  draft.operations
    .find((operation) => operation.id === id)
    ?.paging?.sortKeys.map(({ key, right }) => [key, right]);

describe("sort keys of other list items", () => {
  test("a union item inherits the one restriction its variants share, and differing ones are an error", () => {
    const { draft, diagnostics } = runBeside(`      mixed:
        kind: collection
        id: { mixedId: ChildId }
        item: Mixed
        ops: { list: { paging: offset, sortable: [cost] } }
      shared:
        kind: collection
        id: { sharedId: ChildId }
        item: Shared
        ops: { list: { paging: offset, sortable: [cost] } }
`);

    // The list's output has the same two fields at one pointer, refused on its own.
    expect(located(diagnostics)).toEqual([
      ["field-right-conflict", "/schemas/EvB/properties/cost/restrictedTo"],
      ["sort-key-right", "/surfaces/app/routes/mixed/ops/list/sortable/0"],
    ]);
    expect(diagnostics[1]?.related.map(({ origin }) => origin.pointer)).toEqual([
      "/schemas/EvA/properties/cost/restrictedTo",
      "/schemas/EvB/properties/cost/restrictedTo",
    ]);
    expect(sortKeysOf(draft, "listMixed")).toEqual([["cost", undefined]]);
    expect(sortKeysOf(draft, "listShared")).toEqual([["cost", "items.cost"]]);
  });

  test("a list whose item is not an object or a union of objects has its keys refused", () => {
    const { diagnostics } = runBeside(`      tallies:
        kind: collection
        id: { tallyId: ChildId }
        item: Tally
        ops: { list: { paging: offset, sortable: [count] } }
`);

    expect(located(diagnostics)).toEqual([
      ["sort-key-right", "/surfaces/app/routes/tallies/ops/list/sortable/0"],
    ]);
  });

  test("a resource right whose id schema is a property of the list item is refused on a nested list", () => {
    const { diagnostics } = runBeside(`        member:
          routes:
            children:
              kind: collection
              id: { childId: ChildId }
              item: Child
              ops: { list: { paging: offset, sortable: [margin] } }
`);

    expect(located(diagnostics)).toEqual([
      ["sort-key-right", "/surfaces/app/routes/items/member/routes/children/ops/list/sortable/0"],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "sort key 'margin' of route 'listChildren' has resource right 'items.margin', whose id schema is a property of the list item 'Child', so the key would be checked against the route's subject, not each item's",
    );
  });

  test("a written right that declares params is refused, since a sort key carries none", () => {
    const { draft, diagnostics } = run(
      "            sortable: [{ key: name, right: items.grade }]\n",
      ["name"],
    );

    expect(located(diagnostics)).toEqual([["sort-key-right", `${SORTABLE}/0/right`]]);
    expect(listOf(draft)?.paging?.sortKeys.map(({ right }) => right)).toEqual([undefined]);
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
