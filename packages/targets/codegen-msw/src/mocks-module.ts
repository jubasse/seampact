import type { OperationTypeExports } from "@seampact/codegen-core";
import {
  type ExportRef,
  importSpecifier,
  type Link,
  propertyKey,
  typeNamespaceName,
} from "@seampact/codegen-core";
import { compareRouteSpecificity } from "@seampact/codegen-core/node-server";
import type { ErrorWritings, MockPlan } from "./mock-plan.js";

export const MOCKS_MODULE = "mocks";
export const RUNTIME_MODULE = "runtime";
export const INDEX_MODULE = "index";
export const MODULE_EXTENSION = ".ts";

/** The member of `Mocks` that lists every default handler, so no operation may take its name. */
export const HANDLERS_MEMBER = "handlers";

// One operation as the mocks module writes it: its member, its contract route, its plan and its types.
export interface MockedOperation {
  member: string;
  method: string;
  path: string;
  plan: MockPlan;
  types: OperationTypeExports;
}

// The mocks module: a plan per operation, the `Mocks` interface typed from the types link, and `createMocks`.
export function mocksModuleSource(
  operations: readonly MockedOperation[],
  errorWritings: ErrorWritings,
  typesLink: Link<"types">,
): string {
  const mocksFile = `${MOCKS_MODULE}${MODULE_EXTENSION}`;
  const typeOf = (exportRef: ExportRef) =>
    `${typeNamespaceName(exportRef.module)}.${exportRef.export}`;
  const modules = new Set(
    operations.flatMap(({ types }) => [types.output.module, types.errors.module]).sort(),
  );
  const importLines = [
    `import type { HttpHandler } from "msw";`,
    ...[...modules].map(
      (module) =>
        `import type * as ${typeNamespaceName(module)} from "${importSpecifier(typesLink, { module, export: "" }, mocksFile)}";`,
    ),
    `import { type ErrorWritings, type MockConfig, type MockPlan, type OperationMocks, operationMocks } from "./${RUNTIME_MODULE}.js";`,
  ];

  return [
    importLines.join("\n"),
    `const errorWritings = ${JSON.stringify(errorWritings)} satisfies ErrorWritings;`,
    plansSource(operations),
    mocksInterfaceSource(operations, typeOf),
    createMocksSource(operations, typeOf),
  ].join("\n\n");
}

function plansSource(operations: readonly MockedOperation[]): string {
  const members = operations.map(
    ({ member, plan }) => `${propertyKey(member)}: ${JSON.stringify(plan)},`,
  );

  return `const plans = {\n${members.join("\n")}\n} satisfies Record<string, MockPlan>;`;
}

function operationMocksType(
  operation: MockedOperation,
  typeOf: (exportRef: ExportRef) => string,
): string {
  return `OperationMocks<${typeOf(operation.types.output)}, ${typeOf(operation.types.errors)}>`;
}

function mocksInterfaceSource(
  operations: readonly MockedOperation[],
  typeOf: (exportRef: ExportRef) => string,
): string {
  const members = operations.map((operation) => {
    const route = `${operation.method.toUpperCase()} ${operation.path}`.replaceAll("*/", "*\\/");

    return `/** \`${route}\` */\nreadonly ${propertyKey(operation.member)}: ${operationMocksType(operation, typeOf)};`;
  });

  return `/** The handlers of each operation, and every default handler at once. */\nexport interface Mocks {\n${members.join("\n\n")}\n\n/** Every operation's default handler, the most specific path first: pass them to \`setupServer\` or \`setupWorker\`. */\nreadonly ${HANDLERS_MEMBER}: readonly HttpHandler[];\n}`;
}

function createMocksSource(
  operations: readonly MockedOperation[],
  typeOf: (exportRef: ExportRef) => string,
): string {
  const members = operations.map(
    (operation) =>
      `${propertyKey(operation.member)}: operationMocks<${typeOf(operation.types.output)}, ${typeOf(operation.types.errors)}>(config, plans.${operation.member}, errorWritings),`,
  );
  const byRoute = [...operations].sort((left, right) =>
    compareRouteSpecificity(left.path, right.path),
  );
  const handlers = byRoute.map((operation) => `mocks.${operation.member}.handler,`);

  return `/** The mock handlers of every operation, answering under \`config.baseUrl\` as the api would. */\nexport function createMocks(config: MockConfig): Mocks {\nconst mocks = {\n${members.join("\n")}\n};\n\nreturn { ...mocks, ${HANDLERS_MEMBER}: [\n${handlers.join("\n")}\n] };\n}`;
}
