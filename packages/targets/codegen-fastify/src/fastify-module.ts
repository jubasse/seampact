import type { Refusal } from "@seampact/codegen-core";
import {
  handlerMapDeclarations,
  mixedSegmentRefusals,
  type NodeServerOptions,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `fastify` module of one api: the plugin built from its route table and handler bindings, and the fixed
// exports of ADR 0017 "Placement". No export is named by an operation.

const FASTIFY_MODULE = "fastify";

export function fastifyModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  refusals.push(...mixedSegmentRefusals(ir));

  return [
    'import { createFastifyBoundary } from "./fastify-boundary.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...handlerMapDeclarations(ir, options, FASTIFY_MODULE, refusals),
    "",
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./node-server/outgoing-verdict.js";',
    'export { MAX_RENDERED_ISSUES } from "./node-server/contract-error.js";',
    "",
    "const boundary = createFastifyBoundary<SeampactHooks, ContractHandlers, OperationName>(CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** The api's plugin: `await app.register(plugin, { handlers, hooks })`, without a prefix; `handlers` holds one object per handler interface, keyed by its name (`{ NotesEndpoints: { ... } }`); runs the boot check. */",
    "export const plugin = boundary.plugin;",
    "/** Collects the app's routes for the framework-route boot check: call it right after `Fastify()`, before any route. */",
    "export const collectFrameworkRoutes = boundary.collectFrameworkRoutes;",
    "/** Writes a contract error in the api's format, for an app error handler. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** Renders a contract path's 404 or a router error in the api's format, for `setNotFoundHandler` and `frameworkErrors`; false when it does nothing. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** True on a request a contract route serves, for an app root hook that skips contract routes. */",
    "export const isContractRoute = boundary.isContractRoute;",
    "",
  ].join("\n");
}
