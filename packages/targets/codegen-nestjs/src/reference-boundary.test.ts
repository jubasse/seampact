import { beforeAll, describe, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";
import {
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  typeErrorsOf,
} from "./reference-project.test-support.js";

const PROJECT = projectDirectory("reference-boundary");

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, { bodyValidation: true });
});

describe("the generated reference boundary compiles", () => {
  test("both apis' types, validators and NestJS boundary type-check together", () => {
    expect(typeErrorsOf(PROJECT, files, REFERENCE_COMPILER_OPTIONS)).toEqual([]);
  });

  test("an unknown option is refused by name", () => {
    expect(nestjsTarget.parseOptions({ responses: "loose", extra: true })).toMatchObject({
      status: "refused",
      refusals: [{ code: "options.unknown" }, { code: "options.responses.invalid" }],
    });
  });

  test.each([
    ["tasks", "filteredBy.handler", "listTasks"],
    ["tasks", "concurrency.handler", "updateTask"],
    ["tasks", "owner.handler", "getDraft"],
    ["tasks", "paging.sortKeys.handler", "listTasks"],
    ["tasksService", "deadline.handler", "getTask"],
    ["tasksService", "identity.headers.handler", "getTask"],
  ])("%s: %s names %s", async (api, code, operation) => {
    const outcome = await nestjsTarget.generate({
      ir: readGoldenIr(api),
      options: {},
      links: await referenceLinks(PROJECT, api),
      artefacts: new Set(["boundary"]),
    });

    expect(outcome.status === "generated" ? outcome.warnings : outcome.refusals).toContainEqual(
      expect.objectContaining({ code, operation }),
    );
  });
});
