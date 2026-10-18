import { checkIrClosedDeclaration, type IrWriter } from "@seampact/spec/ir";
import type { DraftOperation, PassReadonly } from "../../../pipeline/seam.js";
import { treeNodesRelayOrigin } from "../../tree/nodes/index.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The public operation a relay route relays, as its own api derived it: the derived draft of a workspace api
// (`relayed`) or the IR of an import (`imported`). tree.nodes already found it and refused an import holding what
// this compiler does not know, so a missing or open one is an internal error. A relay route has no resource of its
// own, so what its version derives from (the version parameter, the `ETag` of a versioned item) is read here.

const OPERATION_KIND = "httpOperation";

/** The public operation of a relay route, with the api that declares it. */
export interface DeriveWireRelayed {
  readonly api: string;
  readonly operation: PassReadonly<DraftOperation>;
}

/** The public operation the route relays, or undefined on a route that relays nothing. */
export function deriveWireRelayedOf(
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): DeriveWireRelayed | undefined {
  const relays = route.operation.relays;

  if (relays === undefined) return undefined;

  const { api, id } = relays;
  const isRelayed = (candidate: { readonly kind?: string; readonly id?: string }) =>
    candidate.kind === OPERATION_KIND && candidate.id === id;
  const fromDraft = scope.context.relayed(api)?.operations.find(isRelayed);

  if (fromDraft !== undefined) return { api, operation: fromDraft };

  const imported = scope.context.imported(api);
  const index =
    imported?.operations.findIndex(
      (candidate) => candidate.kind === OPERATION_KIND && candidate.id === id,
    ) ?? -1;
  const found = imported?.operations[index];
  const closed =
    found === undefined
      ? undefined
      : checkIrClosedDeclaration("Operation", found, `/operations/${index}`).closed;

  if (closed === undefined)
    throw new Error(
      `operation '${route.id}' relays ${api}.${id}, which tree.nodes found but is no closed operation of ${api}`,
    );

  return { api, operation: closed };
}

/** A copy of a derivation of the public operation, its origins in that api named by `api`. */
export function deriveWireRelayedDerivedFrom(
  derivedFrom: PassReadonly<IrWriter.DerivedFrom>,
  api: string,
): IrWriter.DerivedFrom {
  return {
    derivation: derivedFrom.derivation,
    from: derivedFrom.from.map((origin) => treeNodesRelayOrigin(origin, api)),
  };
}
