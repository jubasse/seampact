import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ContractIR,
  HandlerResultMember,
  PagingResponse,
  Response,
  Template,
} from "@seampact/spec/ir";
import ts from "typescript";
import type { FrameworkRouteCheck, HookBootCheck } from "../framework-route-check.js";
import type { NativeDocsDocument } from "../native-docs-document.js";
import type { GeneratedFile, Target } from "../target.js";

// Test support of the Node server targets: generates the reference contract's types, validators and a server
// target's boundary into a consumer layout under the target package's git-ignored `.vitest/`. The generated code
// resolves the framework and zod from that package's devDependencies, and the project's `node_modules` links the
// workspace packages a consumer installs, which the target does not depend on (ADR 0009 "Dependency rules").

const REPOSITORY_ROOT = new URL("../../../../../", import.meta.url);

export const REFERENCE_APIS = ["tasks", "tasksService"] as const;

// Generating the reference project outruns vitest's default 10 s hook limit on a loaded machine.
export const GENERATE_TIMEOUT_MILLISECONDS = 60_000;
// Type-checking both apis takes tens of seconds on a busy machine.
export const TYPE_CHECK_TIMEOUT_MILLISECONDS = 120_000;

// The test apps serve routes of their own, so the framework-route check is off unless a test asks for it.
const FRAMEWORK_ROUTE_CHECK_OFF: FrameworkRouteCheck = { status: "off" };

const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/codegen-zod": "packages/targets/codegen-zod",
  "@seampact/hooks": "packages/runtime/hooks",
};

/** The consumer's compiler options: strict, NodeNext, and the legacy decorators NestJS needs. */
export const REFERENCE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  verbatimModuleSyntax: true,
  experimentalDecorators: true,
  skipLibCheck: true,
  noEmit: true,
  types: ["node"],
};

const REFERENCE_SCENARIO = new URL("../../test-app/reference-scenario.js", import.meta.url);
const TEST_APP_DIRECTORY = "app";

/**
 * Copies a target's test app and the shared scenario it imports into `build/app/`, next to the compiled generated
 * tree; answers the app module's URL.
 */
export function copyTestApp(build: string, appSource: URL): string {
  const directory = join(build, TEST_APP_DIRECTORY);
  const app = join(directory, "reference-app.js");

  mkdirSync(directory, { recursive: true });
  copyFileSync(appSource, app);
  copyFileSync(REFERENCE_SCENARIO, join(directory, "reference-scenario.js"));

  return pathToFileURL(app).href;
}

/** A project directory under the `.vitest/` of the package whose `src/` holds the test file. */
export function projectDirectory(testFileUrl: string, name: string): string {
  return fileURLToPath(new URL(`../.vitest/${name}/`, testFileUrl));
}

/** A change a test makes to a reference api's IR before generating it, as a probe contract. */
export type ReferenceIrChange = (ir: ContractIR, api: string) => ContractIR;

const UNCHANGED_IR: ReferenceIrChange = (ir) => ir;

const BESIDE_API_ID = "tasksBeside";
const SHARED_BASE_PATH = /^\/v1/;
const BESIDE_PATH_START = "/v1/beside";
const BESIDE_ONLY_SURFACE = "besideOnly";
const BESIDE_ONLY_BASE_PATH = "/beside";
const API_NOT_FOUND_CODE = "api.not_found";
const DOMAIN_NOT_FOUND_CODE = "tasks.task_missing";
const KEEPS_NOT_FOUND_ROLE = "archiveTask";

/**
 * Puts, in the `tasksService` slot, a second api beside `tasks` on the same base paths (`/v1`, `/v1/hooks`): the
 * tasks contract under another id, each operation moved under `/v1/beside`, so its routes collide with none of
 * `tasks` and the scenario's handlers and hooks serve it. It also claims `/beside` alone, through a surface without
 * operations, and every operation but `archiveTask` answers a domain 404 code in place of the `notFound` one.
 */
export const besideTasksOnSharedBasePaths: ReferenceIrChange = (ir, api) => {
  if (api === "tasks") return ir;

  const tasks = readGoldenIr("tasks");
  const appSurface = tasks.api.surfaces.app;
  const apiNotFound = tasks.errors[API_NOT_FOUND_CODE];

  if (appSurface === undefined || apiNotFound === undefined) {
    throw new Error("the reference tasks contract lost its app surface or its api.not_found code");
  }

  return {
    ...tasks,
    api: {
      ...tasks.api,
      id: BESIDE_API_ID,
      surfaces: {
        ...tasks.api.surfaces,
        [BESIDE_ONLY_SURFACE]: { ...appSurface, prefix: BESIDE_ONLY_BASE_PATH },
      },
    },
    errors: {
      ...tasks.errors,
      [DOMAIN_NOT_FOUND_CODE]: { ...apiNotFound, code: DOMAIN_NOT_FOUND_CODE },
    },
    operations: tasks.operations.map((operation) => ({
      ...operation,
      path: operation.path.replace(SHARED_BASE_PATH, BESIDE_PATH_START),
      errors:
        operation.id === KEEPS_NOT_FOUND_ROLE
          ? operation.errors
          : operation.errors.map((binding) =>
              binding.code === API_NOT_FOUND_CODE
                ? { ...binding, code: DOMAIN_NOT_FOUND_CODE, roles: [] }
                : binding,
            ),
    })),
  };
};

/** Marks one error code of the `tasks` api `noStore`, as the compiler does for a code whose params are sensitive. */
export function referenceNoStoreCode(code: string): ReferenceIrChange {
  return (ir, api) => {
    if (api !== "tasks") return ir;
    const declaration = ir.errors[code];

    if (declaration === undefined)
      throw new Error(`the reference tasks contract lost its error code '${code}'`);

    return { ...ir, errors: { ...ir.errors, [code]: { ...declaration, noStore: true } } };
  };
}

/** Writes a `title` on one error code of the `tasks` api, which declares none. */
export function referenceErrorTitle(code: string, title: string): ReferenceIrChange {
  return (ir, api) => {
    if (api !== "tasks") return ir;
    const declaration = ir.errors[code];

    if (declaration === undefined)
      throw new Error(`the reference tasks contract lost its error code '${code}'`);

    return { ...ir, errors: { ...ir.errors, [code]: { ...declaration, title } } };
  };
}

/** Marks one cached operation of the `tasks` api `noStore`, as the compiler does for a sensitive field it returns. */
export function referenceNoStoreOperation(operationId: string): ReferenceIrChange {
  return (ir, api) => {
    if (api !== "tasks") return ir;

    return {
      ...ir,
      operations: ir.operations.map((operation) =>
        operation.id === operationId && operation.cache !== undefined
          ? { ...operation, cache: { ...operation.cache, noStore: true } }
          : operation,
      ),
    };
  };
}

/** Makes every operation of the `tasks` api public, with no right, rule, scope or idempotency: an api that needs no hook. */
export const publicTasksApi: ReferenceIrChange = (ir, api) => {
  if (api !== "tasks") return ir;

  return {
    ...ir,
    operations: ir.operations.map(({ idempotency: _idempotency, ...operation }) => ({
      ...operation,
      access: { kind: "public" },
      requires: [],
      fieldRights: [],
      scopes: [],
    })),
  };
};

/** A source that registers an api with no hooks: `Tasks` is the public `tasks` api, `Service` the `tasksService` one. */
export interface HooksRequirementUsage {
  readonly publicTasks: string;
  readonly guardedService: string;
}

/**
 * The type errors of registering the public api without hooks (none expected), and of registering one that needs
 * hooks without them (the missing `hooks` expected), in the files of a project generated with `publicTasksApi`.
 */
export function hooksRequirementErrors(
  project: string,
  files: readonly string[],
  usage: HooksRequirementUsage,
): { readonly publicTasks: string[]; readonly guardedService: string[] } {
  const importOf = (name: string, directory: string): string =>
    `import * as ${name} from "./generated/server/${directory}/index.js";\n\n`;
  const checks = {
    publicTasks: join(project, "public-tasks.check.ts"),
    guardedService: join(project, "guarded-service.check.ts"),
  };

  writeFileSync(checks.publicTasks, `${importOf("Tasks", "tasks")}${usage.publicTasks}\n`);
  writeFileSync(
    checks.guardedService,
    `${importOf("Service", "tasksService")}${usage.guardedService}\n`,
  );

  return {
    publicTasks: typeErrorsOf(project, [...files, checks.publicTasks], REFERENCE_COMPILER_OPTIONS),
    guardedService: typeErrorsOf(
      project,
      [...files, checks.guardedService],
      REFERENCE_COMPILER_OPTIONS,
    ),
  };
}

/** Makes one paged list of the `tasks` api a `paging: none` list: a bare array, no cursor or limit parameter and no paged `Link` header. */
export function referenceUnpagedList(operationId: string): ReferenceIrChange {
  return (ir, api) => {
    if (api !== "tasks") return ir;

    return {
      ...ir,
      operations: ir.operations.map((operation) => {
        if (operation.id !== operationId || operation.paging === undefined) return operation;

        const {
          style: _style,
          defaultLimit: _default,
          maxLimit: _max,
          ...unpaged
        } = operation.paging;

        return {
          ...operation,
          paging: { ...unpaged, sortKeys: [] },
          params: {
            ...operation.params,
            query: operation.params.query.filter(
              (param) => param.name !== "cursor" && param.name !== "limit",
            ),
          },
          responses: operation.responses.map((response) => ({
            ...response,
            shape: "list",
            headers: response.headers.filter((header) => header.name !== "Link"),
          })),
        };
      }),
    };
  };
}

/** The page shape a paging style of the `tasks` api answers, and the format page body it joins its `meta` to. */
export interface ReferencePageShape {
  styleId: string;
  response: PagingResponse;
  handlerResult: HandlerResultMember[];
  formatPageBody?: Template;
}

/**
 * Gives a paging style of the `tasks` api another response, and its page responses the paging headers it writes:
 * its own headers, and `Link` when it has relations.
 */
export function referencePageShape(shape: ReferencePageShape): ReferenceIrChange {
  return (ir, api) => {
    if (api !== "tasks") return ir;

    const style = ir.pagings[shape.styleId];

    if (style === undefined)
      throw new Error(`the tasks api has no paging style '${shape.styleId}'`);

    const headerNames = [
      ...shape.response.headers.map((header) => header.name),
      ...(shape.response.links.length > 0 ? ["Link"] : []),
    ];

    return {
      ...ir,
      formats: Object.fromEntries(
        Object.entries(ir.formats).map(([id, format]) => [
          id,
          shape.formatPageBody === undefined
            ? format
            : {
                ...format,
                success: {
                  ...format.success,
                  page: { ...format.success.page, body: shape.formatPageBody },
                },
              },
        ]),
      ),
      pagings: {
        ...ir.pagings,
        [shape.styleId]: { ...style, response: shape.response, handlerResult: shape.handlerResult },
      },
      operations: ir.operations.map((operation) =>
        operation.paging?.style === shape.styleId
          ? {
              ...operation,
              responses: operation.responses.map((response) =>
                withPagingHeaders(response, headerNames),
              ),
            }
          : operation,
      ),
    };
  };
}

function withPagingHeaders(response: Response, headerNames: readonly string[]): Response {
  if (response.shape !== "page") return response;

  const pagingHeader = response.headers.find(
    (header) => header.derivedFrom?.derivation === PAGING_DERIVATION,
  );

  if (pagingHeader === undefined) throw new Error("the page response has no paging header to copy");

  const otherHeaders = response.headers.filter(
    (header) => header.derivedFrom?.derivation !== PAGING_DERIVATION,
  );

  return {
    ...response,
    headers: [...otherHeaders, ...headerNames.map((name) => ({ ...pagingHeader, name }))],
  };
}

const PAGING_DERIVATION = "paging.params";

/** Applies each change to the golden IR in order. */
export function referenceChanges(...changes: readonly ReferenceIrChange[]): ReferenceIrChange {
  return (ir, api) => changes.reduce((changed, change) => change(changed, api), ir);
}

/** What a test adds to the server target's request: its artefacts, and the document `nativeDocs` follows per api. */
export interface ReferenceServerRequest {
  readonly artefacts?: ReadonlySet<string>;
  readonly hookCheck?: HookBootCheck;
  readonly nativeDocsDocument?: (api: string) => NativeDocsDocument;
}

const BOUNDARY_ONLY: ReadonlySet<string> = new Set(["boundary", "index"]);

/**
 * Writes both reference apis' generated trees into a fresh project; returns every file written. The framework-route
 * check is off unless `frameworkRoutes` turns it on; the server target gets the `boundary` artefact unless
 * `serverRequest` says otherwise.
 */
export async function generateReferenceProject(
  project: string,
  serverTarget: Target,
  serverOptions: Readonly<Record<string, unknown>>,
  changeIr: ReferenceIrChange = UNCHANGED_IR,
  frameworkRoutes: FrameworkRouteCheck = FRAMEWORK_ROUTE_CHECK_OFF,
  serverRequest: ReferenceServerRequest = {},
): Promise<string[]> {
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
  linkWorkspacePackages(project);

  const providers = await linkedProviders(project);
  const written = await Promise.all(
    REFERENCE_APIS.map((api) =>
      generateApi(
        project,
        changeIr(readGoldenIr(api), api),
        api,
        providers,
        serverTarget,
        serverOptions,
        frameworkRoutes,
        serverRequest,
      ),
    ),
  );

  return written.flat();
}

/** The type errors of a set of files, formatted with their location. */
export function typeErrorsOf(
  project: string,
  files: readonly string[],
  options: ts.CompilerOptions,
): string[] {
  const program = ts.createProgram(files, options);

  return formatted(project, ts.getPreEmitDiagnostics(program));
}

/** Compiles the files to JavaScript under `outDir`; returns the type and emit errors. */
export function emitProject(project: string, files: readonly string[], outDir: string): string[] {
  const program = ts.createProgram(files, {
    ...REFERENCE_COMPILER_OPTIONS,
    noEmit: false,
    rootDir: project,
    outDir,
  });
  const emitted = program.emit();

  return formatted(project, [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]);
}

function formatted(project: string, diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) =>
    ts.formatDiagnostic(diagnostic, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => project,
      getNewLine: () => "\n",
    }),
  );
}

export function readGoldenIr(api: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${api}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

function writeFiles(project: string, directory: string, files: readonly GeneratedFile[]): string[] {
  return files.map((file) => {
    const path = join(project, directory, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);

    return path;
  });
}

async function generated(
  target: Target,
  request: Parameters<Target["generate"]>[0],
): Promise<readonly GeneratedFile[]> {
  const outcome = await target.generate(request);

  if (outcome.status !== "generated") {
    throw new Error(
      `${target.metadata.packageName} refused: ${JSON.stringify(outcome.refusals, null, 2)}`,
    );
  }

  return outcome.files;
}

interface Providers {
  readonly types: Target;
  readonly validators: Target;
}

async function linkedProviders(project: string): Promise<Providers> {
  return {
    types: await linkedTarget(project, "@seampact/codegen-ts"),
    validators: await linkedTarget(project, "@seampact/codegen-zod"),
  };
}

/** The types and validators links of a reference api, as the generated project places them. */
export async function referenceLinks(
  project: string,
  api: string,
): Promise<Parameters<Target["generate"]>[0]["links"]> {
  return linksOf(await linkedProviders(project), readGoldenIr(api), api);
}

function linksOf(
  providers: Providers,
  ir: ContractIR,
  api: string,
): Parameters<Target["generate"]>[0]["links"] {
  const types = providers.types.describe(ir, {});
  const validators = providers.validators.describe(ir, {});

  if (types.status !== "described" || validators.status !== "described") {
    throw new Error(`a provider refused to describe ${api}`);
  }

  const typesDescriptor = types.descriptors.types;
  const validatorsDescriptor = validators.descriptors.validators;

  if (typesDescriptor === undefined || validatorsDescriptor === undefined)
    throw new Error("a link is missing");

  return {
    types: {
      descriptor: typesDescriptor,
      location: { kind: "relative", path: `../../types/${api}` },
    },
    validators: {
      descriptor: validatorsDescriptor,
      location: { kind: "relative", path: `../../validators/${api}` },
    },
  };
}

async function generateApi(
  project: string,
  ir: ContractIR,
  api: string,
  providers: Providers,
  serverTarget: Target,
  serverOptions: Readonly<Record<string, unknown>>,
  frameworkRoutes: FrameworkRouteCheck,
  serverRequest: ReferenceServerRequest,
): Promise<string[]> {
  const providerRequest = { ir, options: {}, links: {} };

  return [
    ...writeFiles(
      project,
      `generated/types/${api}`,
      await generated(providers.types, { ...providerRequest, artefacts: new Set(["types"]) }),
    ),
    ...writeFiles(
      project,
      `generated/validators/${api}`,
      await generated(providers.validators, {
        ...providerRequest,
        artefacts: new Set(["validators"]),
      }),
    ),
    ...writeFiles(
      project,
      `generated/server/${api}`,
      await generated(serverTarget, {
        ir,
        options: serverOptions,
        links: linksOf(providers, ir, api),
        artefacts: serverRequest.artefacts ?? BOUNDARY_ONLY,
        frameworkRoutes,
        ...(serverRequest.hookCheck === undefined ? {} : { hookCheck: serverRequest.hookCheck }),
        ...(serverRequest.nativeDocsDocument === undefined
          ? {}
          : { nativeDocsDocument: serverRequest.nativeDocsDocument(api) }),
      }),
    ),
  ];
}

function linkWorkspacePackages(project: string): void {
  for (const [name, directory] of Object.entries(LINKED_PACKAGES)) {
    const link = join(project, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(fileURLToPath(new URL(directory, REPOSITORY_ROOT)), link, "dir");
  }
}

async function linkedTarget(project: string, name: string): Promise<Target> {
  const module: { target: Target } = await import(
    pathToFileURL(join(project, "node_modules", name, "src/index.ts")).href
  );

  return module.target;
}
