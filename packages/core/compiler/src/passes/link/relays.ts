import { checkIrClosedDeclaration, type IrWriter } from "@seampact/spec/ir";
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import {
  type DraftIR,
  type DraftOperation,
  type PassReadonly,
  pipelineCopy,
  pipelinePointerBelow,
  type WorkspacePassContext,
} from "../../pipeline/seam.js";
import { quote } from "../../validate/diagnostics.js";
import { isDiagnosticOrigin } from "../../workspace/order.js";
import { TREE_NODES_OPERATION_KIND } from "../tree/nodes/index.js";

// The `relays` superset (ADR 0006 section 3, ADR 0002 section 7): a relay route copies the shape of its public
// operation, so only the codes can differ. Every code of the public operation outside the gateway's own
// derivations must be a code of the relay route; one that is not is an error at the route's `relays`, naming both
// operations, the code and the role it answers. The public operation comes from a workspace api's derived draft or
// from an import; tree.nodes already refused a relay naming neither, so a missing one here is an internal error.

export const LINK_RELAY_SUPERSET_RULE = "seampact/link/relay-superset";

/**
 * The gateway's own derivations (`docs/grammar/07-routes.md` "Relays"): the access and api-wide codes the
 * gateway answers itself, which a relay route need not answer.
 */
export const LINK_GATEWAY_DERIVATIONS: readonly string[] = [
  "identity.authenticate",
  "signed.identity",
  "csrf.cookieWrite",
  "idempotency.write",
  "principal.requires",
  "binding.mismatch",
  "requirement.errors",
  "scope.errors",
  "fieldRight.restricted",
  "sortKey.restricted",
  "rule.bucket",
  "identity.deadline",
  "identity.versionToken",
  "api.gateway",
  "api.service",
  "response.undeclared",
  "conventions.every",
];

const SUPERSET_FIX =
  "Bind the role to the same code in both apis, for the api with `conventions.errors.derived` or with `errorRoles` on the relay route.";

type Apis = ReadonlyMap<string, PassReadonly<DraftIR>>;
type PublicError = PassReadonly<IrWriter.OperationError>;

const isOperation =
  (id: string) =>
  (candidate: { readonly kind?: unknown; readonly id?: unknown }): boolean =>
    candidate.kind === TREE_NODES_OPERATION_KIND && candidate.id === id;

// The errors of the public operation a relay route names, from a workspace draft or, else, a closed import.
function publicErrorsOf(
  apis: Apis,
  context: WorkspacePassContext,
  relays: PassReadonly<IrWriter.OperationRef>,
): readonly PublicError[] {
  const { api, id } = relays;
  const fromDraft = apis.get(api)?.operations.find(isOperation(id));

  if (fromDraft !== undefined) return fromDraft.errors ?? [];

  const imported = context.imported(api);
  const index = imported?.operations.findIndex(isOperation(id)) ?? -1;
  const found = imported?.operations[index];
  const closed =
    found === undefined
      ? undefined
      : checkIrClosedDeclaration("Operation", found, `/operations/${index}`).closed;

  if (closed === undefined)
    throw new Error(
      `a relay route relays ${api}.${id}, which tree.nodes found but is no closed operation of a workspace api or an import`,
    );

  return closed.errors;
}

const isGatewayOwn = (error: PublicError): boolean =>
  LINK_GATEWAY_DERIVATIONS.includes(error.derivedFrom?.derivation ?? "");

function rolesText(error: PublicError): string {
  const roles = (error.roles ?? []).map((binding) => binding.role);

  return roles.length === 0 ? "" : ` for the role ${roles.map(quote).join(", ")}`;
}

function supersetDiagnostic(
  route: PassReadonly<DraftOperation>,
  routeApi: string,
  relays: PassReadonly<IrWriter.OperationRef>,
  missing: PublicError,
): Diagnostic {
  const origin = route.origin === undefined ? undefined : pipelineCopy(route.origin);

  if (origin === undefined || !isDiagnosticOrigin(origin))
    throw new Error(`the relay route ${routeApi}.${route.id} has no authored origin`);

  return {
    severity: "error",
    rule: LINK_RELAY_SUPERSET_RULE,
    message: `The relay route ${routeApi}.${route.id} does not answer the code ${quote(missing.code)}, which ${relays.api}.${relays.id} answers${rolesText(missing)}.`,
    fix: SUPERSET_FIX,
    origin: { ...origin, pointer: pipelinePointerBelow(origin.pointer, "relays") },
    related: [],
  };
}

/** Reports, under the relay route's api, each code of a public operation its relay route does not answer. */
export function linkRelaySuperset(apis: Apis, context: WorkspacePassContext): void {
  for (const [routeApi, draft] of apis)
    for (const route of draft.operations) {
      const { relays } = route;

      if (relays === undefined) continue;

      const answered = new Set((route.errors ?? []).map((error) => error.code));

      for (const error of publicErrorsOf(apis, context, relays))
        if (!isGatewayOwn(error) && !answered.has(error.code))
          context.report(routeApi, supersetDiagnostic(route, routeApi, relays, error));
    }
}
