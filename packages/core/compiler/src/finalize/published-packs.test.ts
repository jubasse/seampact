import { fileURLToPath } from "node:url";
import { checkIrInvariants } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { loadFsReader } from "../load/index.js";
import { compileWorkspace } from "../pipeline/orchestrator.js";

// The reference contract with each published format pack listed (the golden pack variants, which the golden check
// keeps generated from the reference): every api compiles with no diagnostic and its IR records the pack.

const GOLDEN = fileURLToPath(new URL("../../../../../fixtures/golden/", import.meta.url));
const PUBLISHED_FORMAT_PACKS = ["hal", "laravel", "spring"] as const;
const REFERENCE_APIS = ["tasks", "tasksService"];

describe("the reference contract with a published format pack", () => {
  test.each(PUBLISHED_FORMAT_PACKS)("compiles with pack-%s and records it in each IR", (pack) => {
    const compiled = compileWorkspace({
      reader: loadFsReader(`${GOLDEN}pack-${pack}/contract/`),
      entry: "workspace.yaml",
      guard: true,
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.apis.map((api) => api.api)).toEqual(REFERENCE_APIS);

    for (const api of compiled.apis) {
      expect(api.diagnostics, api.api).toEqual([]);
      expect(api.ir, api.api).toBeDefined();

      if (api.ir === undefined) continue;

      expect(checkIrInvariants(api.ir), api.api).toEqual([]);
      expect(
        api.ir.packs.map((recorded) => recorded.name),
        api.api,
      ).toContain(`@seampact/pack-${pack}`);
    }
  });
});
