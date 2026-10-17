import type { PassContextOf, TreeNode } from "../../../pipeline/seam.js";
import { accessIdentityObject, accessIdentityPointer, accessIdentityString } from "./read.js";
import type { AccessIdentityReporter } from "./report.js";

// A service api (ADR 0002 section 5, FR-8): its caller identity, which every route of it runs under, and the nodes
// that name another identity.

/** Where a service api states its caller identity. */
export const ACCESS_IDENTITY_SERVICE_CALLER_POINTER = "/api/caller/identity";

/** The caller identity of a service api, at `api.caller.identity`; undefined for a product api. */
export function accessIdentityServiceCaller(
  context: PassContextOf<"access.identity">,
): string | undefined {
  const api = accessIdentityObject(context.raw.merged, "api");
  const caller = api === undefined ? undefined : accessIdentityObject(api, "caller");

  return caller === undefined ? undefined : accessIdentityString(caller, "identity");
}

/** Reports every node of a service api that sets an identity other than the caller's. */
export function accessIdentityServiceNodes(
  nodes: readonly TreeNode[],
  caller: string,
  reporter: AccessIdentityReporter,
): void {
  for (const node of nodes) {
    const written = Object.hasOwn(node.settings, "identity") ? node.settings.identity : undefined;

    if (written === undefined || written === caller) continue;

    reporter.error({
      rule: "service-identity",
      message: `${node.kind} '${node.name}' of a service api sets identity ${JSON.stringify(written)}, while every route of the api runs under its caller identity '${caller}'`,
      fix: "Remove the identity: the routes of a service api run under 'api.caller.identity', which surfaces need not repeat.",
      pointer: accessIdentityPointer(node.pointer, "identity"),
    });
  }
}
