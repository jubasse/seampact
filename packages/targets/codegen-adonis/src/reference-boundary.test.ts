import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { target as adonisTarget } from "./index.js";
import {
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { type AdonisMajor, generateAdonisProject } from "./adonis-major.test-support.js";

// Generating and type-checking both apis outruns vitest's default 5 s test limit on a loaded machine.
const COMPILE_TIMEOUT_MILLISECONDS = 60_000;
const MAJORS: readonly AdonisMajor[] = [7, 6];
const INDEX_PROJECT = projectDirectory(import.meta.url, "reference-index");

beforeAll(async () => {
  await generateAdonisProject(INDEX_PROJECT, 7, {});
}, COMPILE_TIMEOUT_MILLISECONDS);

describe("the generated reference boundary compiles", () => {
  test.each(MAJORS)(
    "both apis' types, validators and AdonisJS %i boundary type-check together",
    async (major) => {
      const project = projectDirectory(import.meta.url, `reference-boundary-${major}`);
      const files = await generateAdonisProject(project, major, { bodyValidation: true });

      expect(typeErrorsOf(project, files, REFERENCE_COMPILER_OPTIONS)).toEqual([]);
    },
    COMPILE_TIMEOUT_MILLISECONDS,
  );

  test("every public export of the boundary is reachable through the api's index", async () => {
    const index = await import(join(INDEX_PROJECT, "generated/server/tasks/index.ts"));
    const adonis = await import(join(INDEX_PROJECT, "generated/server/tasks/adonis.ts"));

    expect(Object.keys(index).sort()).toEqual(Object.keys(adonis).sort());
    expect(readFileSync(join(INDEX_PROJECT, "generated/server/tasks/index.ts"), "utf8")).toContain(
      "./handlers.js",
    );
  });

  test("an unknown option is refused by name", () => {
    expect(adonisTarget.parseOptions({ responses: "loose", extra: true })).toMatchObject({
      status: "refused",
      refusals: [{ code: "options.unknown" }, { code: "options.responses.invalid" }],
    });
  });

  test("both golden apis generate without a refusal", async () => {
    for (const api of ["tasks", "tasksService"]) {
      const outcome = await adonisTarget.generate({
        ir: readGoldenIr(api),
        options: {},
        links: await referenceLinks(INDEX_PROJECT, api),
        artefacts: new Set(["boundary"]),
      });

      expect(outcome.status).toBe("generated");
    }
  });
});
