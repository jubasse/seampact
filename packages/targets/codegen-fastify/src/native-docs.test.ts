import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyTestApp,
  emitProject,
  generateReferenceProject,
  nativeDocsDisagreements,
  nativeGoldenComparison,
  projectDirectory,
  readGoldenIr,
  referenceLinks,
  referenceNativeDocsDocument,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, describe, expect, test } from "vitest";
import { target as fastifyTarget } from "./index.js";

// Generates both reference apis with `nativeDocs` on, compiles them, and asks `@fastify/swagger` for the document of
// an app that serves them.

const PROJECT = projectDirectory(import.meta.url, "native-docs");
const BUILD = join(PROJECT, "build");
const APP_SOURCE = new URL("../test-app/native-docs-app.js", import.meta.url);
const GOLDEN_DIRECTORY = new URL("../golden/", import.meta.url);
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

interface ApiModules {
  fastify: object;
  docs: object;
  service?: true;
}

interface NativeDocumentOptions {
  openapi?: string;
  inner?: (documentObject: { openapiObject: object }) => object;
}

interface DocsApp {
  nativeDocument(
    apis: readonly ApiModules[],
    options?: NativeDocumentOptions,
  ): Promise<{ paths: object; info: object }>;
}

let app: DocsApp;
let tasks: ApiModules;
let tasksService: ApiModules;

async function apiModules(api: string): Promise<ApiModules> {
  const directory = join(BUILD, "generated", "server", api);

  return {
    fastify: await import(pathToFileURL(join(directory, "index.js")).href),
    docs: await import(pathToFileURL(join(directory, "fastify-docs.js")).href),
    ...(api === "tasksService" ? { service: true as const } : {}),
  };
}

beforeAll(async () => {
  const files = await generateReferenceProject(
    PROJECT,
    fastifyTarget,
    { bodyValidation: true },
    undefined,
    undefined,
    {
      artefacts: new Set(["boundary", "index", "nativeDocs"]),
      nativeDocsDocument: referenceNativeDocsDocument,
    },
  );

  expect(emitProject(PROJECT, files, BUILD)).toEqual([]);

  app = await import(copyTestApp(BUILD, APP_SOURCE));
  tasks = await apiModules("tasks");
  tasksService = await apiModules("tasksService");
}, SETUP_TIMEOUT_MILLISECONDS);

describe("the Fastify native document", () => {
  test("fastify native document agrees with the seampact document", async () => {
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

  test("an app transformObject passed as inner still runs on the result", async () => {
    const framework = await app.nativeDocument([tasks], {
      inner: ({ openapiObject }) => ({
        ...openapiObject,
        info: { title: "renamed", version: "9" },
      }),
    });

    expect(framework.info).toEqual({ title: "renamed", version: "9" });
    expect(
      nativeDocsDisagreements(referenceNativeDocsDocument("tasks").document, framework),
    ).toEqual([]);
  });

  test("one document for both apis holds every operation of each", async () => {
    const framework = await app.nativeDocument([tasks, tasksService]);

    for (const api of ["tasks", "tasksService"]) {
      const expectedPaths = Object.keys(referenceNativeDocsDocument(api).document.paths as object);

      expect(Object.keys(framework.paths)).toEqual(expect.arrayContaining(expectedPaths));
    }
  });

  test("a framework document that says openapi 3.0.3 is refused with the fix", async () => {
    await expect(app.nativeDocument([tasks], { openapi: "3.0.3" })).rejects.toThrow(
      /openapi: '3\.1\.0'/,
    );
  });

  test("nativeDocs off generates nothing for the framework document", async () => {
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
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
    const outcome = await fastifyTarget.generate({
      ir: readGoldenIr("tasks"),
      options: { bodyValidation: true },
      links: await referenceLinks(PROJECT, "tasks"),
      artefacts: new Set(["boundary", "index", "nativeDocs"]),
      ...(nativeDocsDocument === undefined ? {} : { nativeDocsDocument }),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });
});
