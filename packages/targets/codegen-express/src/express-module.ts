import type { Refusal } from "@seampact/codegen-core";
import {
  handlerMapDeclarations,
  largestBodyLimit,
  type NodeServerOptions,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `express` module of one api: the router factory built from its route table and handler bindings, and the
// fixed exports of ADR 0018 "Placement". No export is named by an operation.

const EXPRESS_MODULE = "express";

export function expressModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  return [
    'import { createExpressBoundary } from "./express-boundary.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...handlerMapDeclarations(ir, options, EXPRESS_MODULE, refusals),
    "",
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./node-server/outgoing-check.js";',
    'export { MAX_RENDERED_ISSUES } from "./node-server/contract-error.js";',
    "",
    "const boundary = createExpressBoundary<SeampactHooks, ContractHandlers>(CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** The api's router: `app.use(router({ handlers, hooks }))`, at the app's root; runs the boot check. */",
    "export const router = boundary.router<OperationName>;",
    "/** An error middleware for refusals raised before the router; mount it after the router. */",
    "export const preRoutingErrorHandler = boundary.preRoutingErrorHandler;",
    "/** Renders a refusal raised before the router on a contract path, or its 404; false when it does nothing. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** Writes a contract error in the api's format, for an app error middleware. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** True on a request a contract route serves, for app middleware that skips contract routes. */",
    "export const isContractRoute = boundary.isContractRoute;",
    "/** The `verify` function of an app-wide JSON parser mounted before the router: keeps the raw body of signed routes. */",
    "export const keepRawBody = boundary.keepRawBody;",
    "/** The largest route body limit; an app-wide JSON parser before the router needs at least this. */",
    `export const LARGEST_BODY_LIMIT = ${largestBodyLimit(ir)};`,
    "",
  ].join("\n");
}
