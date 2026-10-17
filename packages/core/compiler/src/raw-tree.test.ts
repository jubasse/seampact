import { AUTHORING_FILES } from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import { expect, expectTypeOf, test } from "vitest";
import {
  type ApiLayerId,
  type FileLayerId,
  layerKindOf,
  type RawEntryLayer,
  type RawLayer,
  schemaKindOf,
} from "./raw-tree.js";

test("derives the layer kind from the layer", () => {
  expect(layerKindOf("api")).toBe("api");
  expect(layerKindOf("base")).toBe("base");
  expect(layerKindOf("shared")).toBe("shared");
  expect(layerKindOf("pack:acme")).toBe("pack");
});

test("a workspace origin is never a layer kind (checked by typecheck)", () => {
  const origin: Origin["layer"] = "workspace";
  const entry: RawEntryLayer = { layer: "workspace", file: "workspace.yaml", tree: {} };
  // @ts-expect-error `workspace` names the entry file, not a layer of an api
  const kind = () => layerKindOf(origin);
  // @ts-expect-error the entry document is not a layer of an api
  const layer: RawLayer = entry;

  expect(typeof kind).toBe("function");
  expect(layer.layer).toBe("workspace");
});

// One mapping from a layer to the authoring schema it is read as (P6) and validated as: the load
// and validate stages both call `schemaKindOf`.
test("maps every layer form to its authoring schema kind", () => {
  const forms: [FileLayerId, string][] = [
    ["workspace", "workspace"],
    ["api", "api"],
    ["base", "base"],
    ["shared", "base"],
    ["pack:acme", "pack"],
    ["pack:@acme/pack-x", "pack"],
  ];

  for (const [layer, kind] of forms) {
    expect(schemaKindOf(layer)).toBe(kind);
    expect(AUTHORING_FILES).toContain(schemaKindOf(layer));
  }
});

test("a core origin is read from no file: neither a layer of an api nor a file layer", () => {
  expectTypeOf<"workspace">().not.toExtend<ApiLayerId>();
  expectTypeOf<"core">().not.toExtend<ApiLayerId>();
  expectTypeOf<"core">().not.toExtend<FileLayerId>();
  expectTypeOf<"api" | "base" | "shared" | "pack:acme">().toExtend<ApiLayerId>();
  expectTypeOf<"workspace">().toExtend<FileLayerId>();
});
