import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DRAFT_FIXTURE_INVALID_EXAMPLE } from "../../../pipeline/draft-fixture.js";
import type { DraftIR } from "../../../pipeline/seam.js";
import {
  ACCESS_RIGHTS_FIXTURES,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsReferenceWorkspace,
  accessRightsRunContract,
  accessRightsRunReference,
} from "./test-support.js";

// A contract with a scope, a resource right over `ItemId`, a right without subject and a scope right with
// params; each test adds the schemas and routes it needs.
const contract = (
  schemas: string,
  routes: string,
  topLevel = "",
): string => `api: { name: shop, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  clerk: { schemes: { read: [bearer], write: [bearer] }, principal: Clerk }
schemas:
  ShopId: { type: string, format: uuid }
  ItemId: { type: string, format: uuid }
  Clerk: { type: object, required: [clerkId], properties: { clerkId: { type: string } } }
${schemas}
scopes:
  shop: { id: ShopId }
rights:
  items.cost: { subject: { resource: Item, id: ItemId } }
  shop.role: { params: { level: { type: string } }, subject: { scope: shop } }
  audit: {}
  audit2: {}
${topLevel}surfaces:
  app:
    prefix: /v{version}
    identity: clerk
    routes:
${routes}`;

const run = (schemas: string, routes: string, topLevel?: string) =>
  accessRightsRunContract(
    accessRightsLoadFiles({ "api.yaml": contract(schemas, routes, topLevel) }),
  );

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule.replace("seampact/access/", ""), origin.pointer]);

const fieldRightsOf = (draft: DraftIR, id: string) =>
  draft.operations.find((operation) => operation.id === id)?.fieldRights;

const ITEM = `  Item:
    type: object
    required: [itemId]
    properties: { itemId: ItemId, cost: { type: integer, restrictedTo: items.cost } }`;

describe("field rights", () => {
  test("every restricted field reached from an input or output, per pointer and direction, on the fields fixture", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("fields"));
    const expected = JSON.parse(
      readFileSync(`${ACCESS_RIGHTS_FIXTURES}fields/operations.json`, "utf8"),
    );

    expect(diagnostics).toEqual([]);
    expect(
      Object.fromEntries(
        draft.operations.map((operation) => [
          operation.id,
          {
            fieldRights: operation.fieldRights,
            ...(operation.filteredBy === undefined ? {} : { filteredBy: operation.filteredBy }),
            ...(operation.paging === undefined ? {} : { sortKeys: operation.paging.sortKeys }),
          },
        ]),
      ),
    ).toEqual(expected);
  });

  test("conventions.restrictedInput sets the policy of a field that states none", () => {
    const { draft, diagnostics } = run(
      ITEM,
      `      items:
        kind: collection
        id: { itemId: ItemId }
        member:
          routes:
            reprice: { method: post, input: Item, output: Item }
`,
      "conventions:\n  restrictedInput: strip\n",
    );

    expect(diagnostics).toEqual([]);
    expect(
      fieldRightsOf(draft, "repriceItem")?.map(({ direction, inputPolicy, subject }) => [
        direction,
        inputPolicy,
        subject,
      ]),
    ).toEqual([
      ["input", "strip", { source: { in: "path", name: "itemId" } }],
      ["output", undefined, { source: { in: "holderField", name: "itemId" } }],
    ]);
  });

  test("a body that is an array is walked from the schema of its items", () => {
    const { draft, diagnostics } = run(
      ITEM,
      `      items:
        kind: collection
        id: { itemId: ItemId }
        collection:
          routes:
            restock: { method: post, output: { type: array, items: Item } }
`,
    );

    expect(diagnostics).toEqual([]);
    expect(
      fieldRightsOf(draft, "restockItems")?.map(({ schema, pointer }) => [schema, pointer]),
    ).toEqual([["Item", "/cost"]]);
  });

  test("a resource right cannot restrict a create input, which has no id of the resource it creates", () => {
    const { diagnostics } = run(
      ITEM,
      `      items:
        kind: collection
        id: { itemId: ItemId }
        item: Item
        ops:
          create: { input: Item }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-subject", "/surfaces/app/routes/items/ops/create/input"],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "input field 'Item/cost' of create route 'createItem' is restricted to resource right 'items.cost', and a create route has no id of the resource it creates",
    );
    expect(diagnostics[0]?.related.map((related) => related.origin.pointer)).toEqual([
      "/schemas/Item/properties/cost/restrictedTo",
    ]);
  });

  test("an input subject is found among the route's member ids, once, or the field is an error", () => {
    const { diagnostics } = run(
      ITEM,
      `      items:
        kind: collection
        id: { itemId: ItemId }
        collection:
          routes:
            import: { method: post, input: Item }
      pairs:
        kind: collection
        path: 'pairs/{right}'
        id: { left: ItemId, right: ItemId }
        member:
          routes:
            swap: { method: post, input: Item }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-subject", "/surfaces/app/routes/items/collection/routes/import/input"],
      ["field-right-subject", "/surfaces/app/routes/pairs/member/routes/swap/input"],
    ]);
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "input field 'Item/cost' of route 'importItems' is restricted to right 'items.cost', and no member id of the route has its id schema",
      "input field 'Item/cost' of route 'swapLeft' is restricted to right 'items.cost', and its subject could be member id 'left' or 'right'",
    ]);
  });

  test("an output subject is the holder's one property of the right's id schema, else an error", () => {
    const { diagnostics } = run(
      `${ITEM}
  Orphan:
    type: object
    properties: { cost: { type: integer, restrictedTo: items.cost } }
  Twin:
    type: object
    required: [a, b]
    properties: { a: ItemId, b: ItemId, cost: { type: integer, restrictedTo: items.cost } }`,
      `      orphan: { method: get, output: Orphan }
      twin: { method: get, output: Twin }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-subject", "/surfaces/app/routes/orphan"],
      ["field-right-subject", "/surfaces/app/routes/twin"],
    ]);
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "output field 'Orphan/cost' of route 'orphan' is restricted to right 'items.cost', and its holder 'Orphan' has no property of the right's id schema",
      "output field 'Twin/cost' of route 'twin' is restricted to right 'items.cost', and its holder 'Twin' has several properties of the right's id schema: 'a', 'b'",
    ]);
  });

  test("a scope right needs the route to resolve its scope, on input and output", () => {
    const { draft, diagnostics } = run(
      `  Shelf:
    type: object
    properties: { level: { type: integer, restrictedTo: { right: shop.role, params: { level: owner } } } }`,
      `      shelf: { method: post, input: Shelf, output: Shelf }
      shops:
        kind: collection
        id: { shopId: ShopId }
        member:
          scopes: { shop: path.shopId }
          routes:
            shelf: { method: post, input: Shelf, output: Shelf }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-subject", "/surfaces/app/routes/shelf/input"],
      ["field-right-subject", "/surfaces/app/routes/shelf"],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "field 'Shelf/level' of route 'shelf' is restricted to right 'shop.role' of scope 'shop', which the route does not resolve",
    );
    expect(
      fieldRightsOf(draft, "shelfShop")?.map(({ subject, params }) => [subject, params]),
    ).toEqual([
      [{ source: { in: "scope", name: "shop" } }, { level: "owner" }],
      [{ source: { in: "scope", name: "shop" } }, { level: "owner" }],
    ]);
  });

  test("a restriction naming an undeclared right or unfit params is reported once, however many routes reach it", () => {
    const { diagnostics } = run(
      `  Tag:
    type: object
    properties:
      ghost: { type: string, restrictedTo: tags.ghost }
      loud: { type: string, restrictedTo: { right: audit, params: { level: high } } }
      bad: { type: string, restrictedTo: { right: shop.role, params: { level: ${DRAFT_FIXTURE_INVALID_EXAMPLE} } } }`,
      `      tag: { method: get, output: Tag }
      retag: { method: post, input: Tag, output: Tag }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-params", "/schemas/Tag/properties/bad/restrictedTo/params"],
      ["field-right-target", "/schemas/Tag/properties/ghost/restrictedTo"],
      ["field-right-params", "/schemas/Tag/properties/loud/restrictedTo/params"],
    ]);
    expect(diagnostics[2]?.message).toBe(
      "right 'audit' declares no params, but the field's restrictedTo gives some",
    );
  });

  test("a restricted field below a recursive reference is an error once; a recursion without one is walked", () => {
    const { draft, diagnostics } = run(
      `  Comment:
    type: object
    properties:
      secret: { type: string, restrictedTo: audit }
      replies: { type: array, items: Comment }
  Folder:
    type: object
    properties: { name: { type: string }, children: { type: array, items: Folder } }`,
      `      thread: { method: get, output: Comment }
      threads: { method: post, output: Comment }
      tree: { method: get, output: Folder }
`,
    );

    expect(located(diagnostics)).toEqual([["field-right-recursive", "/schemas/Comment"]]);
    expect(fieldRightsOf(draft, "tree")).toEqual([]);
  });
});

describe("restrictions a field right cannot hold", () => {
  test("union variants restricting one pointer differently are an error at the second; identical ones give one entry", () => {
    const { draft, diagnostics } = run(
      `  VarA:
    type: object
    properties: { cost: { type: integer, restrictedTo: audit } }
  VarB:
    type: object
    properties: { cost: { type: integer, restrictedTo: audit2 } }
  VarC:
    type: object
    properties: { cost: { type: integer, restrictedTo: audit } }
  Ev:
    discriminator: kind
    oneOf: { a: VarA, b: VarB }
  Same:
    discriminator: kind
    oneOf: { a: VarA, c: VarC }`,
      `      ev: { method: get, output: Ev }
      same: { method: get, output: Same }
`,
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-conflict", "/schemas/VarB/properties/cost/restrictedTo"],
    ]);
    expect(diagnostics[0]?.related.map(({ origin }) => origin.pointer)).toEqual([
      "/schemas/VarA/properties/cost/restrictedTo",
    ]);
    expect(fieldRightsOf(draft, "ev")).toEqual([]);
    expect(
      fieldRightsOf(draft, "same")?.map(({ schema, pointer, right }) => [schema, pointer, right]),
    ).toEqual([["Same", "/cost", "audit"]]);
  });

  test("a restricted field below the JSON content of a text field is an error at its restriction", () => {
    const { draft, diagnostics } = run(
      `  Meta:
    type: object
    properties: { secret: { type: string, restrictedTo: audit } }
  Upload:
    type: object
    properties:
      meta: { type: string, contentMediaType: application/json, contentSchema: Meta }`,
      "      upload: { method: post, inputMedia: form, input: Upload }\n",
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-position", "/schemas/Meta/properties/secret/restrictedTo"],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "field 'Meta/secret' is restricted to right 'audit' and is reached from the JSON content of field 'Upload/meta', where the IR lists no field right",
    );
    expect(fieldRightsOf(draft, "upload")).toEqual([]);
  });

  test("a restricted field reached from a query parameter or an error's params is an error at its restriction", () => {
    const { diagnostics } = run(
      `  Filter:
    type: object
    properties: { secret: { type: string, restrictedTo: audit } }
  Detail:
    type: object
    properties: { hidden: { type: string, restrictedTo: audit2 } }`,
      "      search: { method: get, query: { filter: Filter } }\n",
      "errors:\n  shop.full: { status: 409, params: { detail: Detail } }\n",
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-position", "/schemas/Detail/properties/hidden/restrictedTo"],
      ["field-right-position", "/schemas/Filter/properties/secret/restrictedTo"],
    ]);
    expect(diagnostics.map(({ message }) => message.replace(/.* is reached from /, ""))).toEqual([
      "the params of error 'shop.full', where the IR lists no field right",
      "query parameter 'filter' of route 'search', where the IR lists no field right",
    ]);
  });

  test("a 16-level shared-reference diamond: unrestricted it is not walked, restricted it hits the cap", () => {
    const diamond = (levels: number, leaf: string) =>
      [
        ...Array.from(
          { length: levels },
          (_, level) =>
            `  L${level}:\n    type: object\n    properties: { a: L${level + 1}, b: L${level + 1} }`,
        ),
        `  L${levels}:\n    type: object\n    properties: { code: ${leaf} }`,
      ].join("\n");
    const free = run(diamond(16, "{ type: string }"), "      deep: { method: get, output: L0 }\n");
    const capped = run(
      diamond(16, "{ type: string, restrictedTo: audit }"),
      "      deep: { method: get, output: L0 }\n",
    );

    expect(free.diagnostics).toEqual([]);
    expect(fieldRightsOf(free.draft, "deep")).toEqual([]);
    expect(located(capped.diagnostics)).toEqual([
      ["field-right-limit", "/surfaces/app/routes/deep"],
    ]);
    expect(capped.diagnostics[0]?.message).toBe(
      "route 'deep' reaches more than 1000 restricted fields from its input and responses, more field rights than one operation may list",
    );
    expect(fieldRightsOf(capped.draft, "deep")).toEqual([]);
  });

  test("a diamond ending in a JSON text field reports the cap", () => {
    const levels = 16;
    const chain = Array.from(
      { length: levels },
      (_, level) =>
        `  L${level}:\n    type: object\n    properties: { a: L${level + 1}, b: L${level + 1} }`,
    );
    const { diagnostics } = run(
      [
        ...chain,
        `  L${levels}:\n    type: object\n    properties: { m: { type: string, contentMediaType: application/json, contentSchema: Meta } }`,
        "  Meta:\n    type: object\n    properties: { secret: { type: string, restrictedTo: audit } }",
      ].join("\n"),
      "      deep: { method: get, output: L0 }\n",
    );

    expect(located(diagnostics)).toContainEqual(["field-right-limit", "/surfaces/app/routes/deep"]);
  });

  test("an optional holder property is no output subject", () => {
    const { diagnostics } = run(
      `  Loose:
    type: object
    properties: { itemId: ItemId, cost: { type: integer, restrictedTo: items.cost } }`,
      "      loose: { method: get, output: Loose }\n",
    );

    expect(located(diagnostics)).toEqual([["field-right-subject", "/surfaces/app/routes/loose"]]);
    expect(diagnostics[0]?.message).toBe(
      "output field 'Loose/cost' of route 'loose' is restricted to right 'items.cost', and the subject 'itemId' of its holder 'Loose' is optional: the subject must be a required field",
    );
  });

  test("two fields of one route whose subject fails are both reported", () => {
    const { diagnostics } = run(
      `  Orphan:
    type: object
    properties:
      cost: { type: integer, restrictedTo: items.cost }
      price: { type: integer, restrictedTo: items.cost }`,
      "      orphan: { method: get, output: Orphan }\n",
    );

    expect(diagnostics.map(({ message }) => message.slice(0, 32))).toEqual([
      "output field 'Orphan/cost' of ro",
      "output field 'Orphan/price' of r",
    ]);
  });

  test("an author string quoted in a message is cut", () => {
    const longName = `audit.${"x".repeat(200)}`;
    const { diagnostics } = run(
      `  Tag:
    type: object
    properties: { label: { type: string, restrictedTo: ${longName} } }`,
      "      tag: { method: get, output: Tag }\n",
    );

    expect(located(diagnostics)).toEqual([
      ["field-right-target", "/schemas/Tag/properties/label/restrictedTo"],
    ]);
    expect(diagnostics[0]?.message).toContain("...', which the rights catalogue");
    expect(diagnostics[0]?.message.length).toBeLessThan(200);
  });
});

describe("relay routes carry no field rights", () => {
  const workspace = accessRightsReferenceWorkspace();

  test("the relay route of tasksService returns a restricted Task field and has no field right", () => {
    const { draft, diagnostics } = accessRightsRunReference(workspace, "tasksService");
    const relay = draft.operations.find((operation) => operation.relays !== undefined);
    const task = draft.schemas.Task;

    expect(diagnostics).toEqual([]);
    expect(relay?.responses?.[0]?.body).toEqual({ kind: "ref", schema: "Task" });
    expect(
      task?.kind === "object" &&
        task.properties.some((property) => property.restrictedTo !== undefined),
    ).toBe(true);
    expect(relay?.fieldRights).toEqual([]);
  });
});
