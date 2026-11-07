import { describe, expect, test } from "vitest";
import { loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import { validateWorkspace } from "../../../validate/index.js";
import {
  deriveErrorsLoadFixture,
  deriveErrorsLocated,
  deriveErrorsRunContract,
} from "./test-support.js";

describe("natures", () => {
  test("contract and pack natures map onto a base, and an error naming one keeps its name beside the base", () => {
    const { draft, diagnostics } = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));

    expect(diagnostics).toEqual([]);
    expect(
      Object.values(draft.natures).map(({ id, base, origin }) => ({
        id,
        base,
        layer: origin.layer,
      })),
    ).toEqual([
      { id: "conflicted", base: "refused", layer: "pack:errors-pack" },
      { id: "throttled", base: "unavailable", layer: "base" },
    ]);
    expect(draft.errors["shop.maintenance"]).toMatchObject({
      nature: "unavailable",
      natureName: "throttled",
    });
    expect(draft.errors["404-gone"]).toMatchObject({ nature: "refused", natureName: "conflicted" });
    expect(draft.errors["members.full"]?.natureName).toBeUndefined();
  });

  test("a nature named like a base is refused with the allowed values", () => {
    const { diagnostics } = deriveErrorsRunContract(deriveErrorsLoadFixture("registry-refused"));
    const refused = diagnostics.find(
      (diagnostic) => diagnostic.rule === "seampact/derive/nature-base",
    );

    expect(refused === undefined ? undefined : deriveErrorsLocated(refused)).toEqual({
      rule: "seampact/derive/nature-base",
      pointer: "/natures/refused",
      related: [],
    });
    expect(refused?.message).toContain("refused, unavailable, failed");
  });

  test("a nature mapped onto anything but a base is refused by the authoring schema before any pass", () => {
    const loaded = loadWorkspace({
      reader: loadMemoryReader({
        "api.yaml": `api: { name: shop, version: 1 }
natures:
  slow: { base: later }
`,
      }),
      entry: "api.yaml",
    });
    const validated = validateWorkspace(loaded.workspace);
    const pointers = validated.apis.flatMap((api) =>
      api.diagnostics.map((item) => item.origin.pointer),
    );

    expect(pointers).toContain("/natures/slow/base");
  });
});
