import {
  ExportNames,
  operationLocation,
  type Refusal,
  typeScriptIdentifier,
} from "@seampact/codegen-core";
import {
  handlerInterfaceName,
  largestBodyLimit,
  operationIdentifier,
  responseSettingsOf,
  SERVER_RUNTIME_PACKAGE,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";
import { deriveName, splitName } from "@seampact/spec/naming";
import type { NestjsOptions } from "./nestjs-options.js";

// The `nestjs` module of one api: the boundary built from its route table, its reply mode and its identity (its own
// `ContractException` subclass and module class name) over the NestJS placement of `@seampact/server-runtime`, the
// fixed exports of ADR 0016 "Registration", and the composite decorator of each operation, named by the operation.

const NESTJS_MODULE = "nestjs";

// The fixed exports; an operation of the same name takes the reserved-name suffix (ADR 0007 section 5).
const FIXED_EXPORTS = [
  "SeampactModule",
  "SEAMPACT_HOOKS",
  "ContractException",
  "responses",
  "renderContractError",
  "isContractRoute",
  "keepRawBody",
  "renderPreRoutingError",
  "preRoutingFilter",
  "LARGEST_BODY_LIMIT",
  "MAX_CHECKED_ERROR_BODY_BYTES",
  "MAX_RENDERED_ISSUES",
] as const;

// The module's own local names, which an operation decorator must not shadow either.
const LOCAL_NAMES = [
  "boundary",
  "createNestBoundary",
  "CONTRACT_API",
  "SeampactHooks",
  "Handlers",
  "ErrorsOf",
  "ContractErrors",
  "BoundaryContractException",
] as const;

// The exports of the docs module, which the index re-exports beside the operation decorators.
const DOCS_EXPORTS = [
  "documentedOperation",
  "withContractComponents",
  "assertContractComponents",
  "createContractDocument",
] as const;

const RESERVED_SUFFIX = "_";
const MODULE_CLASS_SUFFIX = "SeampactModule";

// The class name of the api's module, its type name first (`TasksSeampactModule`), as NestJS logs it.
function moduleClassName(ir: ContractIR): string {
  return `${typeScriptIdentifier(deriveName(splitName(ir.api.id), "schema"))}${MODULE_CLASS_SUFFIX}`;
}

// The operation's decorator: the boundary's, wrapped by the docs module when `nativeDocs` is on.
function operationSource(operationId: string, docsModule: string | undefined): string {
  const boundaryOperation = `boundary.operation(${JSON.stringify(operationId)})`;

  return docsModule === undefined
    ? boundaryOperation
    : `documentedOperation(${boundaryOperation}, ${JSON.stringify(operationId)})`;
}

export function nestjsModuleSource(
  ir: ContractIR,
  options: NestjsOptions,
  refusals: Refusal[],
  docsModule?: string,
): string {
  const names = new ExportNames(NESTJS_MODULE);
  const reserved: readonly string[] = [
    ...FIXED_EXPORTS,
    ...LOCAL_NAMES,
    ...(docsModule === undefined ? [] : DOCS_EXPORTS),
  ];
  const decorators = ir.operations.map((operation, index) => {
    const identifier = operationIdentifier(operation);
    const name = reserved.includes(identifier) ? `${identifier}${RESERVED_SUFFIX}` : identifier;

    names.claim(name, operationLocation(index, operation.id), refusals);

    return `/** The route of '${operation.id}'; \`${name}.input()\` is its validated input, \`${name}.principal()\` and \`${name}.scopes()\` its caller. */\nexport const ${name} = ${operationSource(operation.id, docsModule)};`;
  });

  const handlerMethods = ir.operations.map(
    (operation) =>
      `Handlers.${handlerInterfaceName(ir, operation)}[${JSON.stringify(operationIdentifier(operation))}]`,
  );

  return [
    `import { ContractException as BoundaryContractException, createNestBoundary, type ErrorsOf } from "${SERVER_RUNTIME_PACKAGE}/nestjs";`,
    'import type * as Handlers from "./handlers.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...(docsModule === undefined
      ? []
      : [`import { documentedOperation } from "./${docsModule}.js";`]),
    "",
    `export { MAX_CHECKED_ERROR_BODY_BYTES, MAX_RENDERED_ISSUES } from "${SERVER_RUNTIME_PACKAGE}";`,
    "",
    "/** Every error a handler of the api returns. */",
    `type ContractErrors = ErrorsOf<${handlerMethods.length === 0 ? "never" : handlerMethods.join(" | ")}>;`,
    "",
    "/** A declared error a handler or a service throws: `new ContractException(code, params)`. */",
    "export class ContractException extends BoundaryContractException<ContractErrors> {}",
    "",
    `const boundary = createNestBoundary<SeampactHooks>(CONTRACT_API, ${JSON.stringify({ ...responseSettingsOf(options), reply: options.reply })}, { contractException: ContractException, moduleClassName: ${JSON.stringify(moduleClassName(ir))} });`,
    "",
    "/** The api's dynamic module: `SeampactModule.forRoot(hooks, { logger })` or `forRootAsync({ imports, inject, useFactory })`. */",
    "export const SeampactModule = boundary.SeampactModule;",
    "/** The injection token of the api's hooks, for a test's `overrideProvider`. */",
    "export const SEAMPACT_HOOKS = boundary.SEAMPACT_HOOKS;",
    "/** Overrides the `responses` mode on a controller or a method. */",
    "export const responses = boundary.responses;",
    "/** Writes a contract error in the api's format, for an app filter. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** True on a contract route, for a global interceptor that answers without `next.handle()`. */",
    "export const isContractRoute = boundary.isContractRoute;",
    "/** The JSON parser's `verify` function that keeps the raw body of signed routes, with `rawBody` off. */",
    "export const keepRawBody = boundary.keepRawBody;",
    "/** Renders a refusal raised before routing on a contract path; false when it does nothing. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** A global filter for refusals raised before routing. */",
    "export const preRoutingFilter = boundary.preRoutingFilter;",
    "/** The largest route body limit; the app's JSON parser limit must be at least this. */",
    `export const LARGEST_BODY_LIMIT = ${largestBodyLimit(ir)};`,
    "",
    decorators.join("\n\n"),
    "",
  ].join("\n");
}
