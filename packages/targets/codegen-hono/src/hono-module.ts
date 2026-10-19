import type { Refusal } from "@seampact/codegen-core";
import {
  handlerMapDeclarations,
  literalSegmentRefusals,
  mixedSegmentRefusals,
  type NodeServerOptions,
} from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `hono` module of one api: the registration built from its route table and handler bindings, and the fixed
// exports of ADR 0020 "Placement". No export is named by an operation.

const HONO_MODULE = "hono";

export function honoModuleSource(
  ir: ContractIR,
  options: NodeServerOptions,
  refusals: Refusal[],
): string {
  refusals.push(...literalSegmentRefusals(ir), ...mixedSegmentRefusals(ir));

  return [
    'import { createHonoBoundary } from "./hono-boundary.js";',
    'import type { SeampactHooks } from "./hooks.js";',
    'import { CONTRACT_API } from "./routes.js";',
    ...handlerMapDeclarations(ir, options, HONO_MODULE, refusals, "web"),
    "",
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./web-server/outgoing-verdict.js";',
    'export { MAX_RENDERED_ISSUES } from "./web-server/contract-error.js";',
    "",
    "const boundary = createHonoBoundary<SeampactHooks, ContractHandlers, OperationName>(CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** Registers the api on the app that serves: `registerRoutes(app, { handlers, hooks })`; runs the boot check. */",
    "export const registerRoutes = boundary.registerRoutes;",
    "/** The framework-route boot check: call it with the app once every route is added, before it serves. */",
    "export const checkFrameworkRoutes = boundary.checkFrameworkRoutes;",
    "/** The reply of a contract error in the api's format, for the app's `onError`. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** The api's reply to a 401, 403 or 429 app middleware raised on a contract route, for `onError`; undefined otherwise. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** True on a request a contract route serves, for app middleware that skips contract routes. */",
    "export const isContractRoute = boundary.isContractRoute;",
    "",
  ].join("\n");
}
