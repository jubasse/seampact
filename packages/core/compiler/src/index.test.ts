import type { Origin } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Diagnostic, JsonObject, RawWorkspace } from "./index.js";
import { layerKindOf } from "./index.js";

test("exposes the shared compiler types and helpers through the barrel", () => {
  const tree: JsonObject = {};
  const workspace: RawWorkspace = { root: ".", apis: [], locations: {} };
  expect(layerKindOf("pack:x")).toBe("pack");
  expect(workspace.apis).toEqual([]);
  expect(tree).toEqual({});
});

test("builds a Diagnostic from an Origin of the spec subpath", () => {
  const origin = { layer: "api", pointer: "/operations/a" } satisfies Origin;
  const diagnostic: Diagnostic = {
    severity: "error",
    rule: "seampact/access/deny-by-default",
    message: "m",
    fix: "f",
    origin,
    related: [{ origin: { layer: "base", pointer: "/x" }, message: "other" }],
  };
  expect(diagnostic.related[0]?.origin.layer).toBe("base");
});
