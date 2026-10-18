import { ExportNames, operationLocation, type Refusal } from "@seampact/codegen-core";
import { type NodeServerOptions, operationIdentifier } from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `nestjs` module of one api: the boundary built from its route table, the fixed exports of ADR 0016
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

const RESERVED_SUFFIX = "_";
const NO_BODY_LIMIT = 0;

export function nestjsModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  const names = new ExportNames(NESTJS_MODULE);
  const reserved: readonly string[] = [...FIXED_EXPORTS, ...LOCAL_NAMES];
  const decorators = ir.operations.map((operation, index) => {
    const identifier = operationIdentifier(operation);
    const name = reserved.includes(identifier) ? `${identifier}${RESERVED_SUFFIX}` : identifier;

    names.claim(name, operationLocation(index, operation.id), refusals);

    return `/** The route of '${operation.id}'; \`${name}.input()\` is its validated input. */\nexport const ${name} = boundary.operation(${JSON.stringify(operation.id)});`;
  });
  const largestBodyLimit = Math.max(
    NO_BODY_LIMIT,
    ...ir.operations.map((operation) => operation.input?.bodyLimitBytes ?? NO_BODY_LIMIT),
  );

  return [
    'import { createNestBoundary } from "./nestjs-boundary.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    "",
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./node-server/outgoing-check.js";',
    'export { MAX_RENDERED_ISSUES } from "./node-server/contract-error.js";',
    "",
    `const boundary = createNestBoundary<SeampactHooks>(CONTRACT_API, ${JSON.stringify(options)});`,
    "",
    "/** The api's dynamic module: `SeampactModule.forRoot(hooks)`. */",
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
    `export const LARGEST_BODY_LIMIT = ${largestBodyLimit};`,
    "",
    decorators.join("\n\n"),
    "",
  ].join("\n");
}
