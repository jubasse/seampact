import {
  below,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
} from "@seampact/codegen-core";
import { handlerMapDeclarations, type NodeServerOptions } from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `fastify` module of one api: the plugin built from its route table and handler bindings, and the fixed
// exports of ADR 0017 "Placement". No export is named by an operation.

const FASTIFY_MODULE = "fastify";
const PLACEHOLDER = /\{[^}]+\}/;
const WHOLE_PLACEHOLDER = /^\{[^}]+\}$/;

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
    'export { MAX_CHECKED_ERROR_BODY_BYTES } from "./node-server/outgoing-check.js";',
    'export { MAX_RENDERED_ISSUES } from "./node-server/contract-error.js";',
    "",
    "const boundary = createFastifyBoundary<SeampactHooks, ContractHandlers, OperationName>(CONTRACT_API, GENERATED_SETTINGS, HANDLER_BINDINGS);",
    "",
    "/** The api's plugin: `await app.register(plugin, { handlers, hooks })`, without a prefix; runs the boot check. */",
    "export const plugin = boundary.plugin;",
    "/** Writes a contract error in the api's format, for an app error handler. */",
    "export const renderContractError = boundary.renderContractError;",
    "/** Renders a contract path's 404 or a router error in the api's format, for `setNotFoundHandler` and `frameworkErrors`; false when it does nothing. */",
    "export const renderPreRoutingError = boundary.renderPreRoutingError;",
    "/** True on a request a contract route serves, for an app root hook that skips contract routes. */",
    "export const isContractRoute = boundary.isContractRoute;",
    "",
  ].join("\n");
}

// find-my-way reads a param up to the next `/`, so `{id}:archive` would be one param named `p1::archive`: a path
// segment that mixes a placeholder with literal text is refused until a find-my-way form is proven (A47).
function mixedSegmentRefusals(ir: ContractIR): Refusal[] {
  return ir.operations.flatMap((operation, index) =>
    operation.path
      .split("/")
      .some((segment) => PLACEHOLDER.test(segment) && !WHOLE_PLACEHOLDER.test(segment))
      ? [
          refuseNotGeneratedYet(
            "path.segment.mixed",
            "A path segment that mixes a placeholder with literal text, such as '{id}:archive',",
            below(operationLocation(index, operation.id), "path"),
          ),
        ]
      : [],
  );
}
