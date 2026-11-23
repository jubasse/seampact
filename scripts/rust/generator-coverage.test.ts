import { describe, expect, it } from "vitest";
import { GENERATOR_CRATES } from "./generator-coverage.ts";
import { toolUnitsOf } from "./tools-coverage.ts";

describe("GENERATOR_CRATES", () => {
  it("names TypeScript functions that exist, each ported by one crate", () => {
    const owners = new Map<string, string>();

    for (const spec of GENERATOR_CRATES) {
      for (const unit of toolUnitsOf(spec)) {
        const key = `${unit.file}#${unit.name}`;

        expect(owners.get(key), key).toBeUndefined();
        owners.set(key, spec.crate);
      }
    }

    expect(owners.get("codegen-core/src/generated-paths.ts#unsafePathReason")).toBe("paths");
  });
});
