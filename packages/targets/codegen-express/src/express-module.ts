import type { Refusal } from "@seampact/codegen-core";
import {
  handlerMapDeclarations,
  largestBodyLimit,
  type NodeServerOptions,
  SERVER_RUNTIME_PACKAGE,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `express` module of one api: the router factory built from its route table and handler bindings, and the
// fixed exports of ADR 0018 "Placement", over the Express placement of `@seampact/server-runtime`, which takes the
// app's own `express`. No export is named by an operation.

const EXPRESS_MODULE = "express";

export function expressModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  return [
    'import express from "express";',
    `import { createExpressBoundary } from "${SERVER_RUNTIME_PACKAGE}/express";`,
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...handlerMapDeclarations(ir, options, EXPRESS_MODULE, refusals),
    "",
    `export { MAX_CHECKED_ERROR_BODY_BYTES, MAX_RENDERED_ISSUES } from "${SERVER_RUNTIME_PACKAGE}";`,
    "",
    "const boundary = createExpressBoundary<SeampactHooks, ContractHandlers>(express, CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** The api's router: `app.use(router({ handlers, hooks }))`, at the app's root; `handlers` holds one object per handler interface, keyed by its name (`{ NotesEndpoints: { ... } }`); runs the boot check. */",
    "export const router = boundary.router<OperationName>;",
    "/** The framework-route boot check: call it with the app once every route is mounted, before it listens. */",
    "export const checkFrameworkRoutes = boundary.checkFrameworkRoutes;",
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
