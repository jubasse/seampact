import { ExportNames, operationLocation, type Refusal } from "@seampact/codegen-core";
import {
  largestBodyLimit,
  operationIdentifier,
  responseSettingsOf,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";
import type { NestjsOptions } from "./nestjs-options.js";

// The `nestjs` module of one api: the boundary built from its route table and reply mode, the fixed exports of ADR 0016
// "Registration", and the composite decorator of each operation, named by the operation.

const NESTJS_MODULE = "nestjs";

// The fixed exports; an operation of the same name takes the reserved-name suffix (ADR 0007 section 5).
const FIXED_EXPORTS = [
  "SeampactModule",
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
const LOCAL_NAMES = ["boundary", "createNestBoundary", "CONTRACT_API", "SeampactHooks"] as const;

// The exports of the docs module, which the index re-exports beside the operation decorators.
const DOCS_EXPORTS = [
  "documentedOperation",
  "withContractComponents",
  "assertContractComponents",
  "createContractDocument",
] as const;

const RESERVED_SUFFIX = "_";

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

    return `/** The route of '${operation.id}'; \`${name}.input()\` is its validated input. */\nexport const ${name} = ${operationSource(operation.id, docsModule)};`;
  });

  return [
    'import { createNestBoundary } from "./nestjs-boundary.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...(docsModule === undefined
      ? []
      : [`import { documentedOperation } from "./${docsModule}.js";`]),
    "",
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./node-server/outgoing-verdict.js";',
    'export { MAX_RENDERED_ISSUES } from "./node-server/contract-error.js";',
    "",
    `const boundary = createNestBoundary<SeampactHooks>(CONTRACT_API, ${JSON.stringify({ ...responseSettingsOf(options), reply: options.reply })});`,
    "",
    "/** The api's dynamic module: `SeampactModule.forRoot(hooks, { logger })`. */",
    "export const SeampactModule = boundary.SeampactModule;",
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
