import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);

describe("enum sources and narrowings", () => {
  const run = treeSchemasRunApi(`enums:
  State:
    values: [open, '+', done]
    codeNames: { '+': plus }
    reason: "States belong to this api."
    fallback: open
    summary: A task state.
  Country: { values: [fr, de], source: { vocabulary: ISO 3166-1 } }
  Open: { source: { enum: State } }
schemas:
  Card:
    type: object
    properties:
      state: { enum: State }
      listed: { enum: { narrow: State, to: [done, open], reason: "Drafts are not listed." } }
      inherited: { enum: Open }
`);

  test("an enum keeps its values in written order, its source or local reason, code names and fallback", () => {
    expect(run.diagnostics).toEqual([]);
    expect(Object.values(run.draft.enums)).toEqual([
      {
        id: "State",
        name: { segments: ["state"], role: "schema" },
        values: ["open", "+", "done"],
        codeNames: { "+": { segments: ["plus"], role: "enumMember" } },
        localReason: "States belong to this api.",
        fallback: "open",
        directions: [],
        docs: { summary: "A task state." },
        origin: { layer: "api", pointer: "/enums/State" },
      },
      {
        id: "Country",
        name: { segments: ["country"], role: "schema" },
        values: ["fr", "de"],
        source: { kind: "vocabulary", vocabulary: "ISO 3166-1" },
        directions: [],
        docs: {},
        origin: { layer: "api", pointer: "/enums/Country" },
      },
      {
        id: "Open",
        name: { segments: ["open"], role: "schema" },
        values: ["open", "+", "done"],
        codeNames: { "+": { segments: ["plus"], role: "enumMember" } },
        source: { kind: "enum", enum: "State" },
        directions: [],
        docs: {},
        origin: { layer: "api", pointer: "/enums/Open" },
      },
    ]);
  });

  test("a narrowing keeps the enum's order and its reason", () => {
    const card = run.draft.schemas.Card;
    const types = card?.kind === "object" ? card.properties.map((p) => p.type) : [];

    expect(types).toEqual([
      { kind: "enum", enum: "State" },
      {
        kind: "enum",
        enum: "State",
        narrowedTo: { values: ["open", "done"], reason: "Drafts are not listed." },
      },
      { kind: "enum", enum: "Open" },
    ]);
  });

  test("bad values, sources, reasons, fallbacks, code names and narrowings are refused", () => {
    const refused = treeSchemasRunApi(`enums:
  Empty: { reason: "None yet." }
  Both: { values: [a], source: { enum: Twice } }
  Twice: { values: [a, a] }
  Lost: { source: { enum: Missing } }
  Loop: { source: { enum: Loop } }
  Sourced: { values: [a], source: { vocabulary: V }, reason: "Local." }
  Fallback: { values: [a], fallback: b }
  Named: { values: [a, '-'], codeNames: { b: bee } }
  Same: { values: [a-b, a_b] }
  Same2: { values: [x] }
schemas:
  Card:
    type: object
    properties:
      all: { enum: { narrow: Named, to: [a, '-'] } }
`);

    expect(located(refused)).toEqual([
      ["enum-narrowing", "/schemas/Card/properties/all/enum/to"],
      ["enum-values", "/enums/Empty"],
      ["enum-values", "/enums/Both"],
      ["enum-values", "/enums/Twice/values"],
      ["enum-unknown", "/enums/Lost/source/enum"],
      ["enum-cycle", "/enums/Loop/source/enum"],
      ["enum-reason", "/enums/Sourced/reason"],
      ["enum-fallback", "/enums/Fallback/fallback"],
      ["enum-code-name", "/enums/Named/codeNames/b"],
      ["name-collision", "/enums/Same/values"],
    ]);
    expect(refused.located).toBe(true);
  });

  test("a value with no segment is named by its position, and a code name with none is refused", () => {
    const named = treeSchemasRunApi(`enums:
  Sign: { values: ['+', '-'] }
`);

    expect(named.diagnostics).toEqual([]);
    expect(named.draft.enums.Sign).not.toHaveProperty("codeNames");

    const refused = treeSchemasRunApi(`enums:
  Clash: { values: ['+', value1] }
  Blank: { values: [a], codeNames: { a: '-' } }
`);

    expect(located(refused)).toEqual([
      ["name-collision", "/enums/Clash/values"],
      ["name-segments", "/enums/Blank/codeNames/a"],
    ]);
  });

  test("two enums whose names give one identifier collide", () => {
    const refused = treeSchemasRunApi(`enums:
  HttpCode: { values: [a] }
  HTTPCode: { values: [b] }
`);

    expect(located(refused)).toEqual([["name-collision", "/enums/HTTPCode"]]);
  });
});
