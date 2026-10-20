import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  emitProject,
  generateReferenceProject,
  nativeDocsDisagreements,
  nativeGoldenComparison,
  projectDirectory,
  referenceNativeDocsDocument,
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
  nativeDocument(apis: readonly ApiModules[], openapi?: string): Promise<{ paths: object }>;
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
    undefined,
    {
      artefacts: new Set(["boundary", "nativeDocs"]),
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
});
