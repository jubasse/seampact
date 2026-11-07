import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  emitProject,
  generateReferenceProject,
  nativeDocsDisagreements,
  nativeGoldenComparison,
  projectDirectory,
  readGoldenIr,
  referenceLinks,
  referenceNativeDocsDocument,
  referenceServerOutput,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";

// Generates both reference apis with `nativeDocs` on, compiles them, and asks NestJS's own generator for the
// document of an app that serves them.

const PROJECT = projectDirectory(import.meta.url, "native-docs");
const BUILD = join(PROJECT, "build");
const APP_SOURCE = new URL("../test-app/native-docs-app.js", import.meta.url);
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

interface ApiModules {
  nest: object;
  docs: object;
}

interface DocsApp {
  nativeDocument(
    apis: readonly ApiModules[],
    openapi?: string,
    shadowSchemaName?: string,
  ): Promise<{ paths: object }>;
  contractDocument(
    api: ApiModules,
    shadowSchemaName?: string,
    openapi?: string,
    documentOptions?: object,
  ): Promise<{ openapi: string; paths: object }>;
  bootProblemsWithSwaggerUi(api: ApiModules, docsPath: string): Promise<string>;
}

let app: DocsApp;
let tasks: ApiModules;
let tasksService: ApiModules;

async function apiModules(api: string): Promise<ApiModules> {
  const directory = join(BUILD, "generated", "server", api);

  return {
    nest: await import(pathToFileURL(join(directory, "nestjs.js")).href),
    docs: await import(pathToFileURL(join(directory, "nestjs-docs.js")).href),
  };
}

beforeAll(async () => {
  const files = await generateReferenceProject(
    PROJECT,
    nestjsTarget,
    { bodyValidation: true },
    undefined,
    // The default scope, as an app's config gets it: only routes under the api's base paths are checked.
    { status: "on", allowed: [], scope: "contract" },
    {
      artefacts: new Set(["boundary", "index", "nativeDocs"]),
      nativeDocsDocument: referenceNativeDocsDocument,
    },
  );

  expect(emitProject(PROJECT, files, BUILD)).toEqual([]);

  mkdirSync(join(BUILD, "app"), { recursive: true });
  copyFileSync(APP_SOURCE, join(BUILD, "app", "native-docs-app.js"));
  app = await import(pathToFileURL(join(BUILD, "app", "native-docs-app.js")).href);
  tasks = await apiModules("tasks");
  tasksService = await apiModules("tasksService");
}, SETUP_TIMEOUT_MILLISECONDS);

const GOLDEN_DIRECTORY = new URL("../golden/", import.meta.url);

describe("the NestJS native document", () => {
  test("nestjs native document agrees with the seampact document", async () => {
    for (const [api, modules] of [
      ["tasks", tasks],
      ["tasksService", tasksService],
    ] as const) {
      const framework = await app.nativeDocument([modules]);

      expect(nativeDocsDisagreements(referenceNativeDocsDocument(api).document, framework)).toEqual(
        [],
      );
    }
  });

  test.each(["tasks", "tasksService"])(
    "the native document of %s equals the committed golden",
    async (api) => {
      const modules = api === "tasks" ? tasks : tasksService;
      const { committed, current } = nativeGoldenComparison(
        new URL(`${api}.native.yaml`, GOLDEN_DIRECTORY),
        await app.nativeDocument([modules]),
      );

      expect(current).toBe(committed);
    },
  );

  test("one document for both apis holds every operation of each and their components once", async () => {
    const framework = await app.nativeDocument([tasks, tasksService]);

    for (const api of ["tasks", "tasksService"]) {
      const seampact = referenceNativeDocsDocument(api).document;
      const expectedPaths = Object.keys(seampact.paths as object);

      expect(Object.keys(framework.paths)).toEqual(expect.arrayContaining(expectedPaths));
    }
  });

  test("a framework document that says openapi 3.0.0 is refused with the fix", async () => {
    await expect(app.nativeDocument([tasks], "3.0.0")).rejects.toThrow(/openapi: '3\.1\.0'/);
  });

  test("an app class named like a contract schema is refused, naming both schemas", async () => {
    await expect(app.nativeDocument([tasks], "3.1.0", "Task")).rejects.toThrow(
      /component 'schemas\.Task' of api 'tasks'.*finished document holds/s,
    );
  });

  test("createContractDocument writes the document in one call, agreeing with the seampact document", async () => {
    // From the builder's config and no options: the OpenAPI version and the controller tags are its own.
    const framework = await app.contractDocument(tasks);

    expect(framework.openapi).toBe("3.1.0");
    expect(
      nativeDocsDisagreements(referenceNativeDocsDocument("tasks").document, framework),
    ).toEqual([]);
  });

  test("createContractDocument refuses another OpenAPI version or autoTagControllers: true by name", async () => {
    await expect(app.contractDocument(tasks, undefined, "3.0.3")).rejects.toThrow(
      /says openapi "3\.0\.3".*Set `openapi: '3\.1\.0'`/s,
    );
    await expect(
      app.contractDocument(tasks, undefined, undefined, { autoTagControllers: true }),
    ).rejects.toThrow(/autoTagControllers: true.*Remove the option/s);
  });

  test("Swagger UI outside the api's base path needs no frameworkRoutes entries, under it the check names it", async () => {
    const outside = await app.bootProblemsWithSwaggerUi(tasks, "docs");
    const under = await app.bootProblemsWithSwaggerUi(tasks, "v1/docs");

    expect(outside).toContain("cannot start");
    expect(outside).not.toContain("framework route");
    expect(under).toMatch(/framework routes are outside the contract.*'GET \/v1\/docs'/);
  });

  test("createContractDocument refuses an app class named like a contract schema", async () => {
    await expect(app.contractDocument(tasks, "Task")).rejects.toThrow(
      /component 'schemas\.Task' of api 'tasks'.*finished document holds/s,
    );
  });

  test("nativeDocs off generates nothing for the framework document", async () => {
    const outcome = await nestjsTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index"]),
    });

    if (outcome.status !== "generated") throw new Error("the target refused the reference api");

    expect(
      outcome.files.map((file) => file.path).filter((path) => /docs|native/.test(path)),
    ).toEqual([]);
    expect(
      outcome.files.filter((file) => /from "@(nestjs|fastify)\/swagger"/.test(file.contents)),
    ).toEqual([]);
  });

  test.each([
    ["no document", undefined, "nativeDocs.document.missing"],
    [
      "a document without the operations",
      { document: { paths: {} } },
      "nativeDocs.operation.missing",
    ],
  ])("nativeDocs with %s is refused by name", async (_label, nativeDocsDocument, code) => {
    const outcome = await nestjsTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      outputDirectory: referenceServerOutput(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "nativeDocs"]),
      ...(nativeDocsDocument === undefined ? {} : { nativeDocsDocument }),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });
});
