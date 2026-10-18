import { beforeAll, describe, expect, test } from "vitest";
import {
  generateReferenceProject,
  projectDirectory,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import { target as nestjsTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "reference-boundary");

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, nestjsTarget, { bodyValidation: true });
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
    ["tasks", "concurrency.handler", "updateTask"],
    ["tasks", "owner.handler", "getDraft"],
    ["tasks", "paging.sortKeys.handler", "listTasks"],
    ["tasksService", "deadline.handler", "getTask"],
    ["tasksService", "identity.headers.handler", "getTask"],
  ])("%s: %s names %s", async (api, code, operation) => {
    expect(await reportedForms(api)).toContainEqual(expect.objectContaining({ code, operation }));
  });

  test("the list filter right is the handler's by design, so it is no warning", async () => {
    expect(await reportedForms("tasks")).not.toContainEqual(
      expect.objectContaining({ code: "filteredBy.handler" }),
    );
  });
});

// The warnings of a generated api, or its refusals when it did not generate.
async function reportedForms(api: string): Promise<readonly unknown[]> {
  const outcome = await nestjsTarget.generate({
    ir: readGoldenIr(api),
    options: {},
    links: await referenceLinks(PROJECT, api),
    artefacts: new Set(["boundary"]),
  });

  return (outcome.status === "generated" ? outcome.warnings : outcome.refusals) ?? [];
}
