import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  hooksRequirementErrors,
  projectDirectory,
  publicTasksApi,
  REFERENCE_COMPILER_OPTIONS,
  readGoldenIr,
  referenceLinks,
  referenceServerOutput,
  TYPE_CHECK_TIMEOUT_MILLISECONDS,
  typeErrorsOf,
} from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { beforeAll, describe, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "reference-boundary");

let files: string[] = [];

beforeAll(async () => {
  files = await generateReferenceProject(PROJECT, nestjsTarget, { bodyValidation: true });
}, GENERATE_TIMEOUT_MILLISECONDS);

describe("the generated reference boundary compiles", () => {
  test(
    "both apis' types, validators and NestJS boundary type-check together",
    () => {
      expect(typeErrorsOf(PROJECT, files, REFERENCE_COMPILER_OPTIONS)).toEqual([]);
    },
    TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );

  test("an unknown option is refused by name", () => {
    expect(nestjsTarget.parseOptions({ responses: "loose", extra: true })).toMatchObject({
      status: "refused",
      refusals: [{ code: "options.unknown" }, { code: "options.responses.invalid" }],
    });
  });

  test("parseOptions accepts reply and refuses an unknown value", () => {
    expect(nestjsTarget.parseOptions({})).toMatchObject({ options: { reply: "handler" } });
    expect(nestjsTarget.parseOptions({ reply: "interceptor" })).toMatchObject({
      options: { reply: "interceptor", responses: "strict" },
    });
    expect(nestjsTarget.parseOptions({ reply: "filter", extra: true })).toMatchObject({
      status: "refused",
      refusals: [
        { code: "options.unknown", message: expect.stringContaining("'reply'") },
        { code: "options.reply.invalid" },
      ],
    });
  });

  test.each(["handler", "interceptor"])(
    "the generated module passes the %s reply mode to the boundary",
    async (reply) => {
      const outcome = await nestjsTarget.generate({
        ir: readGoldenIr("tasks"),
        options: { reply },
        links: await referenceLinks(PROJECT, "tasks"),
        outputDirectory: referenceServerOutput(PROJECT, "tasks"),
        artefacts: new Set(["boundary", "index"]),
      });
      const nestjsModule =
        outcome.status === "generated"
          ? outcome.files.find((file) => file.path.split("/").at(-1) === "nestjs.ts")
          : undefined;

      expect(nestjsModule?.contents).toMatch(
        new RegExp(
          `createNestBoundary<SeampactHooks>\\(\\s*CONTRACT_API,\\s*\\{[^}]*reply: "${reply}"`,
        ),
      );
    },
  );

  test.each([
    ["tasks", "concurrency.handler", "updateTask"],
    ["tasks", "owner.handler", "getDraft"],
    ["tasks", "paging.sortKeys.handler", "listTasks"],
    ["tasksService", "deadline.handler", "getTask"],
    ["tasksService", "identity.headers.handler", "getTask"],
  ])("%s: %s names %s", async (api, code, operation) => {
    expect(await reportedForms(api)).toContainEqual(expect.objectContaining({ code, operation }));
  });

  test("a sort key restricted to a right is refused by name until the boundary checks it", async () => {
    const ir = readGoldenIr("tasks");
    const listTasks = ir.operations.find((operation) => operation.id === "listTasks");
    const [sortKey] = listTasks?.paging?.sortKeys ?? [];

    if (sortKey === undefined) throw new Error("the golden listTasks has no sort key");

    sortKey.right = "tasks.read";

    expect(await reportedForms("tasks", ir)).toContainEqual(
      expect.objectContaining({ code: "paging.sortKey.restricted.unsupported" }),
    );
  });

  test("a scope id read from a query param is refused once, by name", async () => {
    const ir = readGoldenIr("tasks");
    const scopedOperation = ir.operations.find((operation) => operation.scopes.length > 0);
    const [scope] = scopedOperation?.scopes ?? [];

    if (scope === undefined) throw new Error("the golden tasks api has no scoped operation");

    scope.source = { ...scope.source, in: "query" };

    const forms = await reportedForms("tasks", ir);

    expect(forms).toContainEqual(expect.objectContaining({ code: "scope.source.unsupported" }));
    expect(forms).not.toContainEqual(expect.objectContaining({ code: "valueSource.unsupported" }));
  });

  test("the list filter right is the handler's by design, so it is no warning", async () => {
    expect(await reportedForms("tasks")).not.toContainEqual(
      expect.objectContaining({ code: "filteredBy.handler" }),
    );
  });
});

// The warnings of a generated api, or its refusals when it did not generate.
async function reportedForms(
  api: string,
  ir: ContractIR = readGoldenIr(api),
): Promise<readonly unknown[]> {
  const outcome = await nestjsTarget.generate({
    ir,
    options: {},
    links: await referenceLinks(PROJECT, api),
    outputDirectory: referenceServerOutput(PROJECT, api),
    artefacts: new Set(["boundary", "index"]),
  });

  return (outcome.status === "generated" ? outcome.warnings : outcome.refusals) ?? [];
}

describe("an api with only public operations asks for no hooks", () => {
  test(
    "it registers without hooks, and an api that needs hooks still requires them",
    async () => {
      const project = projectDirectory(import.meta.url, "public-api");
      const files = await generateReferenceProject(project, nestjsTarget, {}, publicTasksApi);
      const errors = hooksRequirementErrors(project, files, {
        publicTasks: ["export const module = Tasks.SeampactModule.forRoot();"].join("\n"),
        guardedService: ["export const module = Service.SeampactModule.forRoot();"].join("\n"),
      });

      expect(errors.publicTasks).toEqual([]);
      expect(errors.guardedService).toHaveLength(1);
      // forRoot takes the hooks, then its options.
      expect(errors.guardedService[0]).toContain("Expected 1-2 arguments");
    },
    GENERATE_TIMEOUT_MILLISECONDS + TYPE_CHECK_TIMEOUT_MILLISECONDS,
  );
});
