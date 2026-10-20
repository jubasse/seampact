import { type ContractIR, IR_REVISION, walkIrInstance } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { PACK_CONTRACT } from "../bundle/bundle.test-support.js";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import { loadMemoryReader } from "../load/reader.js";
import { compileWorkspace } from "../pipeline/orchestrator.js";
import {
  finalizeCompleteDraft,
  finalizeExpectIr,
  finalizeReferenceContext,
  finalizeReferenceRaw,
} from "./complete-draft.js";
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
      const { ir, sourceMap } = finalizeExpectIr(
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
    const { ir } = finalizeExpectIr(
      finalizeCompleteDraft("tasks"),
      finalizeReferenceContext("tasks"),
    );

    firstOperation(ir).origin = { api: "tasksService", layer: "api", pointer: "/not/in/this/api" };
    const sourceMap = finalizeSourceMap(ir, finalizeReferenceRaw("tasks"));

    expect(Object.keys(sourceMap.locations).some((key) => key.endsWith("#/not/in/this/api"))).toBe(
      false,
    );
  });

  test("an origin in no table is an internal error naming it", () => {
    const { ir } = finalizeExpectIr(
      finalizeCompleteDraft("tasks"),
      finalizeReferenceContext("tasks"),
    );
    const origin = { layer: "api", pointer: "/not/in/this/api" } as const;

    firstOperation(ir).origin = origin;

    expect(() => finalizeSourceMap(ir, finalizeReferenceRaw("tasks"))).toThrow(
      `the origin '${diagnosticLocationKey(origin)}' at '/operations/0/origin' of api 'tasks' is in no source table`,
    );
  });

  test("an origin on the workspace layer is an internal error", () => {
    const { ir } = finalizeExpectIr(
      finalizeCompleteDraft("tasks"),
      finalizeReferenceContext("tasks"),
    );

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

  const PACK_FILE_OF_NAME = ".packs/@acme/pack-a@1.2.0/lib/pack.yaml";

  function packFilesOf(files: Record<string, string>, layer: string): string[] {
    const result = compileWorkspace({
      reader: loadMemoryReader(files),
      entry: "api.yaml",
      guard: true,
    });

    expect(result.diagnostics).toEqual([]);

    return Object.entries(result.apis[0]?.sourceMap?.locations ?? {})
      .filter(([key]) => key.startsWith(`${layer}#`))
      .map(([, location]) => location.file)
      .sort();
  }

  const liftedPack = (files: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(files).map(([file, text]) => [
        file.startsWith("node_modules/") ? `../${file}` : file,
        text,
      ]),
    );

  test("a pack installed in the workspace and one hoisted above it give the same side table", () => {
    const inside = packFilesOf(PACK_CONTRACT, "pack:@acme/pack-a");
    const above = packFilesOf(liftedPack(PACK_CONTRACT), "pack:@acme/pack-a");

    expect(inside.length).toBeGreaterThan(0);
    expect(new Set(inside)).toEqual(new Set([PACK_FILE_OF_NAME]));
    expect(above).toEqual(inside);
  });

  const EXTENDING_CONTRACT = {
    ...PACK_CONTRACT,
    "node_modules/@acme/pack-a/lib/pack.yaml": `pack: { name: '@acme/pack-a', version: 1.2.0, extends: ['./base.yaml'] }\n`,
    "node_modules/@acme/pack-a/lib/base.yaml":
      "pack: { name: 'house:base', version: 0.1.0 }\nconventions:\n  paging: { default: cursor }\n",
  };

  test.each([
    ["in the workspace", EXTENDING_CONTRACT],
    ["above the workspace", liftedPack(EXTENDING_CONTRACT)],
  ])("a path pack inside a package pack is named in its package, %s", (_where, files) => {
    expect(packFilesOf(files, "pack:house:base")).toEqual(
      expect.arrayContaining([".packs/@acme/pack-a@1.2.0/lib/base.yaml"]),
    );
  });
});
