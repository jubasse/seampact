import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IrWriter, Origin } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import type { DraftIR } from "../pipeline/seam.js";
import { FINALIZE_ID_COLLISION_RULE, finalizeIdCollisions } from "./collisions.js";
import { finalizeCompleteDraft, finalizeReferenceRaw } from "./complete-draft.js";
import { finalizeIr } from "./finalize.js";

type CollisionEdit =
  | { addError: string; origin: Origin }
  | { copy: "schemas" | "enums"; from: string; id: string }
  | { input: string; schema: string };

interface CollisionCase {
  name: string;
  edits: CollisionEdit[];
  diagnostics: { rule: string; origin: Origin; related: Origin[] }[];
}

const FIXTURE = fileURLToPath(
  new URL("../../../../../fixtures/passes/finalize/id-collisions/cases.json", import.meta.url),
);
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: CollisionCase[] };
const API = "tasks";

function operationOf(draft: DraftIR, id: string) {
  const operation = draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the draft has no operation ${id}`);

  return operation;
}

function copyEntry<T extends { id: string }>(
  entries: Record<string, T>,
  from: string,
  id: string,
): void {
  const entry = entries[from];

  if (entry === undefined) throw new Error(`the draft has no entry ${from} to copy`);
  entries[id] = { ...structuredClone(entry), id };
}

function applyEdit(draft: DraftIR, edit: CollisionEdit): void {
  if ("addError" in edit) {
    draft.errors[edit.addError] = {
      code: edit.addError,
      nature: "refused",
      http: { status: 400 },
      docs: {},
      origin: edit.origin,
    };

    return;
  }

  if ("input" in edit) {
    const input = operationOf(draft, edit.input).input;

    if (input === undefined) throw new Error(`the operation ${edit.input} has no input`);
    input.schema = { kind: "ref", schema: edit.schema };

    return;
  }

  if (edit.copy === "schemas") copyEntry(draft.schemas, edit.from, edit.id);
  else copyEntry(draft.enums, edit.from, edit.id);
}

function editedDraft(edits: readonly CollisionEdit[]): DraftIR {
  const draft = finalizeCompleteDraft(API);

  for (const edit of edits) applyEdit(draft, edit);

  return draft;
}

const located = (diagnostic: Diagnostic) => ({
  rule: diagnostic.rule,
  origin: diagnostic.origin,
  related: diagnostic.related.map((related) => related.origin),
});

// Reaches a code from the first operation, so pruning keeps it.
function reachedCode(draft: DraftIR, code: string): DraftIR {
  draft.operations[0]?.errors?.push({ code } satisfies IrWriter.OperationError);

  return draft;
}

function finalizeCollecting(draft: DraftIR) {
  const reported: Diagnostic[] = [];
  const finalized = finalizeIr(draft, {
    raw: finalizeReferenceRaw(API),
    report: (diagnostic) => reported.push(diagnostic),
  });

  return { finalized, reported };
}

describe("finalize id collisions", () => {
  test("the reference draft has none", () => {
    expect(finalizeIdCollisions(finalizeCompleteDraft(API))).toEqual([]);
  });

  test.each(cases)("$name", ({ edits, diagnostics }) => {
    expect(finalizeIdCollisions(editedDraft(edits)).map(located)).toEqual(diagnostics);
  });

  test("each names both sides, and a code collision says to rename the code", () => {
    const [diagnostic] = finalizeIdCollisions(
      editedDraft([
        {
          addError: "Task.input",
          origin: { layer: "shared", pointer: "/errors/api.rate_limited" },
        },
      ]),
    );

    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toBe(
      "The error code 'Task.input' equals the id of the strict input 'Task.input' of the schema 'Task', so a document would write both as the component 'Task.input'.",
    );
    expect(diagnostic?.fix).toBe("Rename the code.");
    expect(diagnostic?.related[0]?.message).toBe(
      "the strict input 'Task.input' of the schema 'Task' is declared here",
    );
  });

  test("two core declarations under one id are an internal error", () => {
    const draft = editedDraft([
      { addError: "ApiEmptyBody", origin: { layer: "core", pointer: "/errors/ApiEmptyBody" } },
    ]);

    expect(() => finalizeIdCollisions(draft)).toThrow(
      "finalize found the error code 'ApiEmptyBody' and the schema 'ApiEmptyBody' under one id",
    );
  });

  test("an operation with no name has no input name to compare, and validation refuses it", () => {
    const draft = editedDraft([{ copy: "schemas", from: "Task", id: "PurgeTaskInput" }]);

    delete operationOf(draft, "purgeTask").name;

    expect(finalizeIdCollisions(draft)).toEqual([]);
    expect(() => finalizeCollecting(draft)).toThrow("must have required property 'name'");
  });

  test("an api with a collision gives no IR, and a pruned declaration collides with nothing", () => {
    const origin: Origin = { layer: "shared", pointer: "/errors/api.rate_limited" };
    const refused = finalizeCollecting(
      reachedCode(editedDraft([{ addError: "Task", origin }]), "Task"),
    );
    const unused = finalizeCollecting(editedDraft([{ addError: "Task", origin }]));

    expect(refused.finalized).toBeUndefined();
    expect(refused.reported.map((diagnostic) => diagnostic.rule)).toEqual([
      FINALIZE_ID_COLLISION_RULE,
    ]);
    expect(unused.reported).toEqual([]);
    expect(unused.finalized?.ir.errors).not.toHaveProperty("Task");
  });
});

describe("finalize diagnostics are located", () => {
  test("every collision is located, with its related sides, in the api's own table", () => {
    const raw = finalizeReferenceRaw(API);
    const diagnostics = cases.flatMap(({ edits }) => finalizeIdCollisions(editedDraft(edits)));

    expect(diagnostics.length).toBeGreaterThan(0);

    for (const diagnostic of diagnostics) {
      const origins = [diagnostic.origin, ...diagnostic.related.map((related) => related.origin)];

      for (const origin of origins) {
        expect(origin.layer).not.toBe("core");
        expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
      }
    }
  });
});
