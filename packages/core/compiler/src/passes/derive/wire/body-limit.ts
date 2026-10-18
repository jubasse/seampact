import { treeNodesBodyLimit } from "../../tree/nodes/limits.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// `input.bodyLimitBytes` (`body.limit`, ADR 0006 section 5) on every input, a proof-only one included
// (`docs/ir/13-schema-forms.md`): the nearest `bodyLimit` of the route, else `conventions.batch.bodyLimit` for a
// batch op, else `conventions.bodyLimit` (1 MiB). The bytes come from the resolver tree.nodes checks file sizes
// with, so both halves read one limit for one node. A limit that does not parse is reported by tree.nodes
// (`body-limit`), so the compile already fails and the input is left without one.

/** The body limit in bytes of the route's node, through the one resolver tree.nodes uses. */
export function deriveWireBodyLimitBytes(
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): number | undefined {
  return treeNodesBodyLimit(route.node, scope.context)?.bytes;
}

/** Writes the body limit of the route's input. */
export function deriveWireBodyLimit(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const input = route.operation.input;

  if (input === undefined) return;

  const bytes = deriveWireBodyLimitBytes(route, scope);

  if (bytes !== undefined) input.bodyLimitBytes = bytes;
}
