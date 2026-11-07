import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  checkIrInvariants,
  checkIrSupport,
  type ContractIR,
  createIrValidator,
  IR_REVISION,
  IR_VERSION,
} from "@seampact/spec/ir";
import { GOLDEN_DIRECTORY } from "./golden.ts";
import { REPO_ROOT } from "./repo-root.ts";

// The golden IRs, found by walking the directory: a case another lane adds is read without a change here.
function goldenFilesEnding(suffix: string): string[] {
  const root = join(REPO_ROOT, GOLDEN_DIRECTORY);

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(suffix))
    .sort()
    .map((path) => join(root, path));
}

const IR_FILES = goldenFilesEnding(".ir.json");
const SOURCE_MAP_FILES = goldenFilesEnding(".source-map.json");
const READER_SUPPORT = {
  irVersions: [IR_VERSION],
  irRevision: IR_REVISION,
  kinds: ["httpOperation"],
  features: [],
};

describe("golden IR reads in TypeScript", () => {
  it("finds at least one golden IR and side table", () => {
    expect(IR_FILES.length).toBeGreaterThan(0);
    expect(SOURCE_MAP_FILES.length).toBeGreaterThan(0);
  });

  describe.each(IR_FILES)("%s", (file) => {
    const ir: ContractIR = JSON.parse(readFileSync(file, "utf8"));

    it("is valid in the open and the strict form", () => {
      for (const form of ["open", "strict"] as const) {
        const report = createIrValidator(Ajv2020, form).validate(ir);

        expect(report, form).toEqual({
          valid: true,
          unknownKinds: [],
          unknownValues: [],
          unknownMembers: [],
          problems: [],
        });
      }
    });

    it("holds the IR invariants", () => {
      expect(checkIrInvariants(ir)).toEqual([]);
    });

    it("is supported by this reader", () => {
      expect(checkIrSupport(ir, READER_SUPPORT)).toEqual([]);
    });
  });

  describe.each(SOURCE_MAP_FILES)("%s", (file) => {
    it("is a valid side table", () => {
      const report = createIrValidator(Ajv2020, "strict").validateSourceMap(
        JSON.parse(readFileSync(file, "utf8")),
      );

      expect(report.valid).toBe(true);
    });
  });
});
