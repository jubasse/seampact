import { describe, expect, test } from "vitest";
import { draftFixtureSchemaTables } from "../../../pipeline/draft-fixture.js";
import { treeSchemasRunApi, treeSchemasRunReference } from "./test-support.js";

const LIST = "/surfaces/app/routes/items/ops/list";
const SEND = "/surfaces/app/routes/send";

const contract = (conventions: string) =>
  treeSchemasRunApi(`${conventions}enums:
  State: { values: [open, done], reason: "Local states." }
rules:
  fresh: { proof: { in: body, name: ticket, schema: { type: integer } } }
schemas:
  Filter: { type: object, properties: { state: { enum: State }, tags: { type: array, items: { type: string } } } }
  Deep: { type: object, properties: { filter: Filter } }
  Form:
    type: object
    properties:
      count: { type: integer }
      flag: { type: boolean }
      text: { type: string }
      state: { enum: State }
      tags: { type: array, items: { type: integer } }
      filter: Filter
      deep: Deep
      blob: { opaque: "Free-form." }
surfaces:
  app:
    routes:
      items:
        kind: collection
        id: { itemId: { type: string } }
        ops:
          list:
            query:
              limit?: { type: integer }
              tags?: { type: array, items: { type: string } }
              filter?: Filter
      send:
        method: post
        inputMedia: form
        input: { type: object, properties: { note: { type: string }, ids: { type: array, items: { type: integer } } } }
`);

const wire = (kind: string, style = "form", explode = true, brackets = false) => ({
  kind,
  style,
  explode,
  brackets,
});

describe("query wire kinds", () => {
  test("each kind under the default conventions, at query fields and form field positions", () => {
    const run = contract("");
    const form = (name: string) => run.service.queryWire(`/schemas/Form/properties/${name}`);

    expect(run.diagnostics).toEqual([]);
    expect(form("count")).toEqual(wire("number"));
    expect(form("flag")).toEqual(wire("boolean"));
    expect(form("text")).toEqual(wire("text"));
    expect(form("state")).toEqual(wire("text"));
    expect(form("tags")).toEqual(wire("list"));
    expect(form("filter")).toEqual(wire("object"));
    expect(form("deep")).toBeUndefined();
    expect(form("blob")).toBeUndefined();
    expect(run.service.queryWire(`${LIST}/query/limit?`)).toEqual(wire("number"));
    expect(run.service.queryWire(`${LIST}/query/tags?`)).toEqual(wire("list"));
    expect(run.service.queryWire(`${LIST}/query/filter?`)).toEqual(wire("object"));
    expect(run.service.queryWire(`${SEND}/input/properties/note`)).toEqual(wire("text"));
    expect(run.service.queryWire("/rules/fresh/proof/schema")).toEqual(wire("number"));
    expect(run.service.queryWire(`${SEND}/input`)).toBeUndefined();
  });

  test.each([
    ["repeat", "explode", wire("list"), wire("object")],
    ["comma", "explode", wire("list", "form", false), wire("object")],
    ["brackets", "deepObject", wire("list", "form", true, true), wire("object", "deepObject")],
  ])("lists %s and objects %s set the style", (lists, objects, list, object) => {
    const run = contract(`conventions: { query: { lists: ${lists}, objects: ${objects} } }\n`);

    expect(run.service.queryWire(`${LIST}/query/tags?`)).toEqual(list);
    expect(run.service.queryWire(`${LIST}/query/filter?`)).toEqual(object);
    expect(run.service.queryWire(`${LIST}/query/limit?`)).toEqual(wire("number"));
  });

  test("a derived property and each answer is a copy; the reference rule proof matches the fixture", () => {
    const run = treeSchemasRunReference("tasks");
    const update = "/schemas/UpdateTask/properties/expectedVersion";
    const first = run.service.queryWire(update);

    expect(first).toEqual(wire("number"));

    if (first !== undefined) first.kind = "text";
    expect(run.service.queryWire(update)).toEqual(wire("number"));

    for (const { pointer, wire: expected } of draftFixtureSchemaTables("tasks").queryWires)
      expect([pointer, run.service.queryWire(pointer)]).toEqual([pointer, expected]);
  });
});

describe("a map-typed query field or rule proof", () => {
  test("is refused, since no query wire encodes its keys", () => {
    const run = treeSchemasRunApi(`rules:
  fresh: { proof: { in: body, name: ticket, schema: Labels } }
schemas:
  Labels: { type: object, additionalProperties: { type: string } }
surfaces:
  app:
    routes:
      search:
        method: get
        query: { labels?: Labels }
`);

    expect(run.diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([
      ["seampact/tree/query-map", "/rules/fresh/proof/schema"],
      ["seampact/tree/query-map", "/surfaces/app/routes/search/query/labels?"],
    ]);
    expect(run.service.queryWire("/rules/fresh/proof/schema")).toBeUndefined();
  });
});
