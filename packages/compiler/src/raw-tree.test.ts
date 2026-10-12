import { expect, test } from "vitest";
import { layerKindOf } from "./raw-tree.js";

test("derives the layer kind from the layer", () => {
  expect(layerKindOf("api")).toBe("api");
  expect(layerKindOf("base")).toBe("base");
  expect(layerKindOf("shared")).toBe("shared");
  expect(layerKindOf("pack:acme")).toBe("pack");
});
