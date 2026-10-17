import { describe, expect, test } from "vitest";
import { draftFixtureApply } from "../pipeline/draft-fixture.js";
import { createDraftIR, type DraftIR } from "../pipeline/seam.js";
import type { JsonValue } from "../raw-tree.js";
import { finalizeCanonicalOrder } from "./canonical-order.js";
import { finalizeCompleteDraft, finalizeReferenceContext } from "./complete-draft.js";
import { finalizeIr } from "./finalize.js";
import { finalizeSerializeIr } from "./serialize.js";

type Arrange = (items: JsonValue[]) => JsonValue[];

const asWritten: Arrange = (items) => items;
const reversed: Arrange = (items) => [...items].reverse();

// A hand-built draft holding every "Sorted" array of ADR 0004 section 9, each arranged by `arrange`. Only the
// members the order reads are written: finalizeCanonicalOrder checks nothing else.
function sortedArraysDraft(arrange: Arrange): DraftIR {
  const draft = createDraftIR();
  const directions = () => arrange(["output", "input"]);
  const schemes = () => arrange(["z", "a", "M"]);

  draftFixtureApply(draft, {
    errors: {
      "b.x": { http: { status: 409 } },
      "a.y": { http: { status: 404 } },
      "a.x": { http: { status: 409 } },
    },
    schemas: {
      Union: {
        kind: "union",
        directions: directions(),
        variants: arrange([{ tag: "b" }, { tag: "a" }]),
      },
      Item: { kind: "object", directions: directions() },
    },
    enums: { Color: { directions: directions() } },
    scalars: { Slug: { directions: directions() } },
    identities: {
      user: {
        kind: "credential",
        schemes: { read: schemes(), write: schemes(), optionalRead: schemes() },
      },
      hook: { kind: "signed" },
    },
    operations: arrange([
      {
        id: "b",
        callerKinds: arrange(["user", "service"]),
        tags: arrange(["é", "z", "Z"]),
        responses: arrange([{ status: 404 }, { status: 200 }, { status: 1000 }]),
        errors: arrange([
          { code: "z.undeclared" },
          { code: "b.x" },
          { code: "a.x" },
          { code: "a.y" },
        ]),
        fieldRights: arrange([
          { schema: "T", pointer: "/b", direction: "output" },
          { schema: "T", pointer: "/a", direction: "output" },
          { schema: "T", pointer: "/a", direction: "input" },
          { schema: "S", pointer: "/z", direction: "output" },
        ]),
        bindings: arrange([
          { from: { in: "path", name: "b" }, to: { in: "scope" } },
          { from: { in: "path", name: "a" }, to: { in: "scope", name: "y" } },
          { from: { in: "path", name: "a" }, to: { in: "scope", name: "x" } },
          { from: { in: "address", prefixBits: 24 }, to: { in: "scope" } },
          { from: { in: "address", prefixBits: 16 }, to: { in: "scope" } },
        ]),
        cache: { vary: arrange(["b", "a"]) },
        paging: { sortKeys: arrange([{ key: "b" }, { key: "a" }]) },
      },
      { id: "a" },
      { id: "B" },
    ]),
  });

  return draft;
}

function sorted(arrange: Arrange): DraftIR {
  const draft = sortedArraysDraft(arrange);

  finalizeCanonicalOrder(draft);

  return draft;
}

// The draft of an api with its catalogues' members and its sorted arrays in another order than the passes wrote.
function shuffledReferenceDraft(api: "tasks" | "tasksService"): DraftIR {
  const draft = finalizeCompleteDraft(api);
  const reversedRecord = <V>(record: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(record).reverse());

  draft.operations.reverse();
  draft.schemas = reversedRecord(draft.schemas);
  draft.rights = reversedRecord(draft.rights);

  for (const operation of draft.operations) operation.fieldRights?.reverse();

  for (const identity of Object.values(draft.identities))
    if (identity.kind === "credential") identity.schemes.read.reverse();

  return draft;
}

describe("canonical order is independent of pass order", () => {
  test("every sorted array of a hand-built draft sorts the same from two orders", () => {
    const fromWritten = sorted(asWritten);

    expect(sorted(reversed)).toEqual(fromWritten);
    expect(fromWritten.operations.map((candidate) => candidate.id)).toEqual(["B", "a", "b"]);
    expect(fromWritten.operations[2]).toMatchObject({
      callerKinds: ["service", "user"],
      tags: ["Z", "z", "é"],
      responses: [{ status: 200 }, { status: 404 }, { status: 1000 }],
      errors: [{ code: "a.y" }, { code: "a.x" }, { code: "b.x" }, { code: "z.undeclared" }],
      fieldRights: [
        { schema: "S", pointer: "/z", direction: "output" },
        { schema: "T", pointer: "/a", direction: "input" },
        { schema: "T", pointer: "/a", direction: "output" },
        { schema: "T", pointer: "/b", direction: "output" },
      ],
      bindings: [
        { from: { in: "address", prefixBits: 16 } },
        { from: { in: "address", prefixBits: 24 } },
        { from: { in: "path", name: "a" }, to: { name: "x" } },
        { from: { in: "path", name: "a" }, to: { name: "y" } },
        { from: { in: "path", name: "b" } },
      ],
      cache: { vary: ["a", "b"] },
      paging: { sortKeys: [{ key: "a" }, { key: "b" }] },
    });
    expect(fromWritten.schemas.Union).toMatchObject({
      directions: ["input", "output"],
      variants: [{ tag: "a" }, { tag: "b" }],
    });
    expect(fromWritten.enums.Color?.directions).toEqual(["input", "output"]);
    expect(fromWritten.scalars.Slug?.directions).toEqual(["input", "output"]);
    expect(fromWritten.identities.user).toMatchObject({
      schemes: { read: ["M", "a", "z"], write: ["M", "a", "z"], optionalRead: ["M", "a", "z"] },
    });
  });

  test.each(["tasks", "tasksService"] as const)(
    "%s finalizes to the same bytes from a shuffled draft",
    (api) => {
      const context = finalizeReferenceContext(api);
      const fromPasses = finalizeIr(finalizeCompleteDraft(api), context);
      const fromShuffled = finalizeIr(shuffledReferenceDraft(api), context);

      expect(fromShuffled.ir).toEqual(fromPasses.ir);
      expect(finalizeSerializeIr(fromShuffled.ir)).toBe(finalizeSerializeIr(fromPasses.ir));
    },
  );
});

describe("kept arrays keep their order", () => {
  test("requires, proofs, scopes, upstream, params and packs keep the order the passes wrote", () => {
    const kept = {
      packs: [{ name: "z" }, { name: "a" }],
      operations: [
        {
          id: "op",
          requires: [{ rule: "z" }, { rule: "a" }],
          input: { proofs: [{ name: "z" }, { name: "a" }] },
          scopes: [{ scope: "z" }, { scope: "a" }],
          upstream: ["z", "a"],
          params: {
            path: [{ name: "z" }, { name: "a" }],
            query: [{ name: "z" }, { name: "a" }],
            header: [],
          },
        },
      ],
    };
    const draft = createDraftIR();

    draftFixtureApply(draft, structuredClone(kept));
    finalizeCanonicalOrder(draft);

    expect(draft).toMatchObject(kept);
  });

  test("a reference operation's requirements keep their order once finalized", () => {
    const draft = finalizeCompleteDraft("tasks");
    const operation = draft.operations.find((candidate) => (candidate.requires?.length ?? 0) > 1);

    operation?.requires?.reverse();
    const written = structuredClone(operation?.requires);
    const { ir } = finalizeIr(draft, finalizeReferenceContext("tasks"));
    const finalized = ir.operations.find((candidate) => candidate.id === operation?.id);

    expect(written?.length).toBeGreaterThan(1);
    expect(finalized?.requires).toEqual(written);
  });
});
