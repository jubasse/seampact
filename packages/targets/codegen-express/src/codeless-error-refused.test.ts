import {
  generateReferenceProject,
  projectDirectory,
} from "@seampact/codegen-core/node-server/test-support";
import { expect, test } from "vitest";
import { target } from "./index.js";

// `conventions.errors.requireCode: false` lets a contract write an error body with no code; no consumer reads that
// yet, so the server targets refuse it by name.

test("an error format that writes no code is refused by name", async () => {
  const project = projectDirectory(import.meta.url, "codeless-error");

  await expect(
    generateReferenceProject(project, target, {}, (ir) => {
      for (const format of Object.values(ir.formats)) {
        format.error.body = { kind: "object", members: [] };
      }

      return ir;
    }),
  ).rejects.toThrow("format.error.codeless");
});
