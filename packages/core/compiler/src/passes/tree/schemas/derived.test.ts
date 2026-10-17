import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const schemas = (yaml: string) => treeSchemasRunApi(`schemas:\n${yaml}`);
const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);
const propertiesOf = (run: TreeSchemasRun, id: string) => {
  const schema = run.draft.schemas[id];

  return schema?.kind === "object" ? schema.properties : [];
};

const SOURCE = `
  Article:
    type: object
    required: [articleId, title]
    properties:
      articleId: { type: string, format: uuid }
      title: { type: string, minLength: 1, maxLength: 200, description: The heading. }
      body: { type: string, maxLength: 20000, sensitive: true }
      state: { type: string, restrictedTo: articles.seeState }
`;

describe("pick and omit", () => {
  const run = schemas(`${SOURCE}
  Written:
    type: object
    required: [title]
    properties:
      title: { type: string, minLength: 1, maxLength: 200, description: The heading. }
      body: { type: string, maxLength: 20000, sensitive: true }
  Picked:
    pick: { from: Article, fields: [body, title] }
    title: A new article.
    examples: [{ title: First }]
  Omitted:
    omit: { from: Article, fields: [articleId] }
    required: []
    properties:
      body: { nullable: true, deprecated: true, title: Text }
      state: { restrictedTo: { right: roles, params: { allowed: [owner] } }, default: open }
  FromMerged:
    pick: { from: Merged, fields: [extra, title] }
  Merged: { allOf: [Picked, { type: object, properties: { extra: { type: boolean } } }] }
  FromDerived:
    omit: { from: Omitted, fields: [body] }
  InlineMember:
    allOf: [{ pick: { from: Article, fields: [title] } }, { type: object, properties: { more: { type: integer } } }]
`);

  test("a derived object compiles to the object its kept properties write out", () => {
    expect(run.diagnostics).toEqual([]);
    const withoutOrigin = (id: string) =>
      propertiesOf(run, id).map(({ origin: _origin, ...rest }) => rest);

    expect(withoutOrigin("Picked")).toEqual([...withoutOrigin("Written")].reverse());
    expect(propertiesOf(run, "Picked").map((p) => p.origin.pointer)).toEqual([
      "/schemas/Article/properties/body",
      "/schemas/Article/properties/title",
    ]);
    expect(run.draft.schemas.Picked).toMatchObject({
      kind: "object",
      origin: { pointer: "/schemas/Picked" },
      docs: { summary: "A new article." },
      examples: [{ title: "First" }],
    });
  });

  test("omit keeps the source order, required replaces, an overlay replaces what it sets", () => {
    const [title, body, state] = propertiesOf(run, "Omitted");

    expect(propertiesOf(run, "Omitted").map((p) => [p.name, p.optional])).toEqual([
      ["title", true],
      ["body", true],
      ["state", true],
    ]);
    expect(title?.docs).toEqual({ description: "The heading." });
    expect(body).toMatchObject({
      nullable: true,
      deprecated: true,
      sensitive: true,
      docs: { summary: "Text" },
    });
    expect(state).toMatchObject({
      default: "open",
      restrictedTo: {
        right: "roles",
        params: { allowed: ["owner"] },
        origin: { pointer: "/schemas/Omitted/properties/state/restrictedTo" },
      },
    });
  });

  test("an allOf, another derived object and an inline member are sources too", () => {
    expect(propertiesOf(run, "FromMerged").map((p) => p.name)).toEqual(["extra", "title"]);
    expect(propertiesOf(run, "FromDerived").map((p) => p.name)).toEqual(["title", "state"]);
    expect(propertiesOf(run, "InlineMember").map((p) => p.name)).toEqual(["title", "more"]);
  });

  test("a field the source lacks, a bad overlay or source is refused at its pointer", () => {
    const refused = schemas(`${SOURCE}
  Lacks: { pick: { from: Article, fields: [title, missing, title] } }
  NotKept:
    pick: { from: Article, fields: [title] }
    required: [body]
    properties: { body: { nullable: true } }
  Required:
    pick: { from: Article, fields: [title] }
    properties: { title: { default: Untitled, examples: [A] } }
  StillRequired:
    pick: { from: Article, fields: [title] }
    properties: { title: { default: Untitled } }
  Restricted:
    pick: { from: Article, fields: [title] }
    properties: { title: { restrictedTo: articles.seeTitle } }
  Mapped: { type: object, additionalProperties: { type: string } }
  FromMap: { pick: { from: Mapped, fields: [a] } }
  FromNothing: { omit: { from: Nothing, fields: [a] } }
  CycleA: { pick: { from: CycleB, fields: [a] } }
  CycleB: { omit: { from: CycleA, fields: [b] } }
`);

    expect(located(refused)).toEqual([
      ["derived-field", "/schemas/Lacks/pick/fields/1"],
      ["derived-field", "/schemas/Lacks/pick/fields/2"],
      ["required-unknown", "/schemas/NotKept/required"],
      ["annotation-position", "/schemas/Required/properties/title/examples"],
      ["required-property", "/schemas/StillRequired/properties/title"],
      ["required-property", "/schemas/Restricted/properties/title"],
      ["derived-source", "/schemas/FromMap/pick/from"],
      ["schema-unknown", "/schemas/FromNothing/omit/from"],
      ["schema-cycle", "/schemas/CycleA"],
    ]);
    expect(refused.located).toBe(true);
    expect(refused.draft.schemas.Lacks).toBeUndefined();
  });

  test("an overlay of a property the object does not keep is refused", () => {
    const refused = schemas(`${SOURCE}
  Overlay:
    pick: { from: Article, fields: [title] }
    properties: { body: { nullable: true } }
`);

    expect(located(refused)).toEqual([["derived-overlay", "/schemas/Overlay/properties/body"]]);
  });
});
