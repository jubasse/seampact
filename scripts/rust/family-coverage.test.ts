import { describe, expect, it } from "vitest";
import { FAMILY_CRATES, familyFilesOf, familyUnitsOf } from "./family-coverage.ts";
import { GENERATOR_CRATES } from "./generator-coverage.ts";
import { toolUnitsOf } from "./tools-coverage.ts";

describe("FAMILY_CRATES", () => {
  it("gives every source file one crate, with functions in it", () => {
    const owners = new Map<string, string>();

    for (const spec of FAMILY_CRATES) {
      expect(familyUnitsOf(spec).length, spec.crate).toBeGreaterThan(0);

      for (const file of familyFilesOf(spec)) {
        expect(owners.get(file), file).toBeUndefined();
        owners.set(file, spec.crate);
      }
    }
  });

  it("takes no function a layer 3.3 crate ports", () => {
    const layer33 = new Set(
      GENERATOR_CRATES.flatMap((spec) =>
        toolUnitsOf(spec).map((unit) => `core/${unit.file}#${unit.name}`),
      ),
    );

    for (const spec of FAMILY_CRATES)
      for (const unit of familyUnitsOf(spec))
        expect(layer33.has(`${unit.file}#${unit.name}`), `${unit.file}#${unit.name}`).toBe(false);
  });
});
