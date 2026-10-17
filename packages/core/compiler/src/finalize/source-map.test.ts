import { type ContractIR, IR_REVISION, walkIrInstance } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import {
  finalizeCompleteDraft,
  finalizeReferenceContext,
  finalizeReferenceRaw,
} from "./complete-draft.js";
import { finalizeIr } from "./finalize.js";
import { finalizeSourceMap } from "./source-map.js";
import { finalizeAssertSourceMap } from "./validate.js";

interface FoundOrigin {
  readonly api?: unknown;
  readonly layer: unknown;
  readonly pointer: unknown;
}

function originsOf(ir: ContractIR): FoundOrigin[] {
  const origins: FoundOrigin[] = [];

  walkIrInstance(ir, (node) => {
    if (node.kind !== "object" || node.definition !== "Origin") return;
    const { api, layer, pointer } = node.value;

    origins.push({ api, layer, pointer });
  });

  return origins;
}

// The first operation of an IR, which a test relocates.
function firstOperation(ir: ContractIR) {
  const [operation] = ir.operations;

  if (operation === undefined) throw new Error("the reference IR has no operation");

  return operation;
}

describe("side table covers every origin", () => {
  test.each(["tasks", "tasksService"] as const)(
    "%s: one entry per file origin, none for a core one",
    (api) => {
      const raw = finalizeReferenceRaw(api);
      const { ir, sourceMap } = finalizeIr(
        finalizeCompleteDraft(api),
        finalizeReferenceContext(api),
      );
      const origins = originsOf(ir);
      const fileOrigins = origins.filter(
        (origin) => origin.layer !== "core" && origin.api === undefined,
      );
      const keys = new Set(
        fileOrigins.map((origin) => `${String(origin.layer)}#${String(origin.pointer)}`),
      );

      expect(sourceMap.irRevision).toBe(IR_REVISION);
      expect(new Set(Object.keys(sourceMap.locations))).toEqual(keys);
      expect(origins.some((origin) => origin.layer === "core")).toBe(true);

      for (const key of keys) expect(sourceMap.locations[key]).toEqual(raw.locations[key]);
    },
  );

  test("an origin copied from another api resolves in that api's table, not here", () => {
    const { ir } = finalizeIr(finalizeCompleteDraft("tasks"), finalizeReferenceContext("tasks"));

    firstOperation(ir).origin = { api: "tasksService", layer: "api", pointer: "/not/in/this/api" };
    const sourceMap = finalizeSourceMap(ir, finalizeReferenceRaw("tasks"));

    expect(Object.keys(sourceMap.locations).some((key) => key.endsWith("#/not/in/this/api"))).toBe(
      false,
    );
  });

  test("an origin in no table is an internal error naming it", () => {
    const { ir } = finalizeIr(finalizeCompleteDraft("tasks"), finalizeReferenceContext("tasks"));
    const origin = { layer: "api", pointer: "/not/in/this/api" } as const;

    firstOperation(ir).origin = origin;

    expect(() => finalizeSourceMap(ir, finalizeReferenceRaw("tasks"))).toThrow(
      `the origin '${diagnosticLocationKey(origin)}' at '/operations/0/origin' of api 'tasks' is in no source table`,
    );
  });

  test("an origin on the workspace layer is an internal error", () => {
    const { ir } = finalizeIr(finalizeCompleteDraft("tasks"), finalizeReferenceContext("tasks"));

    firstOperation(ir).origin = { layer: "workspace", pointer: "" };

    expect(() => finalizeSourceMap(ir, finalizeReferenceRaw("tasks"))).toThrow(
      "the origin at '/operations/0/origin' of api 'tasks' has no valid layer or pointer",
    );
  });

  test("a side table its schema refuses is an internal error", () => {
    const location = { file: "api.yaml", line: 1, column: 1, endLine: 1, endColumn: 2 };

    expect(() =>
      finalizeAssertSourceMap("tasks", {
        irRevision: IR_REVISION,
        locations: { "core#/formats/bare": location },
      }),
    ).toThrow("finalize built an invalid side table for api 'tasks'");
  });
});
