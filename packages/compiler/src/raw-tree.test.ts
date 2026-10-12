import type { Origin } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { layerKindOf, type RawEntryLayer, type RawLayer } from "./raw-tree.js";

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
