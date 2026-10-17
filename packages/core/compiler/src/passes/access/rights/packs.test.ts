import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createDraftIR } from "../../../pipeline/seam.js";
import {
  ACCESS_RIGHTS_FIXTURES,
  accessRightsApiOf,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsMarkerService,
  accessRightsRunContract,
  accessRightsRunOn,
} from "./test-support.js";

const expected = (file: string): unknown =>
  JSON.parse(readFileSync(`${ACCESS_RIGHTS_FIXTURES}crud-rights/${file}.json`, "utf8"));

// A pack whose entries each break one rule, applied to a collection without scopes beside a route of no resource.
const REFUSED_PACK = `pack: { name: odd, version: 1.0.0, extends: [] }
derive:
  - entry: reads
    select: { access: [read] }
    require: { right: '{resource}.read' }
  - entry: members
    select: { op: [get] }
    declareRight: { name: '{resource}.{op}', subject: { member: resource } }
  - entry: lists
    select: { op: [list] }
    declareRight: { name: '{resource}.{op}', subject: { collection: innermostScope } }
  - entry: colons
    select: { op: [list] }
    declareRight: { name: '{resource}:{op}' }
`;

const REFUSED_API = `api: { name: shop, version: 1 }
packs: [./pack.yaml]
conventions:
  rights: { pattern: '^[a-z]+\\.[a-z]+$' }
schemas:
  ItemId: { type: string }
  Item: { type: object, required: [itemId], properties: { itemId: ItemId } }
rights:
  items.get: { subject: { scope: shop } }
scopes:
  shop: { id: ItemId }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The fixture checks derivations only. }
    routes:
      health: { method: get }
      items:
        kind: collection
        id: { itemId: ItemId }
        item: Item
        ops: [list, get]
`;

describe("pack-derived rights", () => {
  test("rights and requirements of the CRUD rights pack, each with its derivation, before the written ones", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("crud-rights"));

    expect(diagnostics).toEqual([]);
    expect({
      rights: { ...draft.rights },
      rules: { ...draft.rules },
      scopes: { ...draft.scopes },
      buckets: { ...draft.buckets },
    }).toEqual(expected("catalogues"));
    expect(
      Object.fromEntries(
        draft.operations.map((operation) => [
          operation.id,
          { scopes: operation.scopes, requires: operation.requires },
        ]),
      ),
    ).toEqual(expected("operations"));
  });

  test("templates, subjects, names and targets an entry cannot give a route are errors at the entry", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({ "api.yaml": REFUSED_API, "pack.yaml": REFUSED_PACK }),
    );

    expect(diagnostics.map(({ rule, origin }) => [rule, origin.layer, origin.pointer])).toEqual([
      ["seampact/access/pack-right", "pack:odd", "/derive/2/declareRight"],
      ["seampact/access/right-pattern", "pack:odd", "/derive/3/declareRight"],
      ["seampact/access/pack-right", "pack:odd", "/derive/1/declareRight"],
      ["seampact/access/pack-template", "pack:odd", "/derive/0/require/right"],
      ["seampact/access/requirement-target", "pack:odd", "/derive/0/require/right"],
    ]);
    expect(diagnostics[2]?.related).toEqual([
      {
        origin: { layer: "api", pointer: "/rights/items.get" },
        message: "the right is declared here",
      },
    ]);
    expect(Object.keys(draft.rights)).toEqual(["items.get"]);
  });

  test("a derive entry of a pack tree.nodes did not record is an internal error", () => {
    const workspace = accessRightsLoadFiles({
      "api.yaml": `api: { name: shop, version: 1 }
packs: [./pack.yaml]
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks derivations only. }
    routes:
      health: { method: get }
`,
      "pack.yaml": REFUSED_PACK,
    });
    const raw = accessRightsApiOf(workspace);
    const service = accessRightsMarkerService({
      typeUse: () => undefined,
      queryWire: () => undefined,
      checkExample: () => [],
    });

    expect(() => accessRightsRunOn(raw, workspace, createDraftIR(), service)).toThrow(
      "the derive entry at /derive/0 comes from pack 'odd', which tree.nodes did not record in packs",
    );
  });
});
