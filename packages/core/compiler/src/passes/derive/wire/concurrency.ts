import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesOpOwner } from "../../tree/nodes/index.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddParam,
  deriveWireAddSuccessHeader,
} from "./params.js";
import { type DeriveWireRoute, type DeriveWireScope, deriveWireOriginAt } from "./routes.js";

// The version a write compares (`concurrency.version`, A33, ADR 0006 section 5). tree.nodes wrote `version` and
// `field`, a body source on a DELETE without input already read from the query. A body source is the version
// property tree.schemas added to the input, so only `derivedFrom` is written here; a query or header source is a
// required parameter typed like `field` on the resource's item. `header.If-Match` sends an entity tag instead: the
// `If-Match` parameter and the `ETag` response header on every success are strings (RFC 9110 section 8.8.3), the
// tag computed from `field`. `from` names the resource's `concurrency`, then the route's `concurrency: inherit`.

const CONCURRENCY = "concurrency.version";

const IF_MATCH = "if-match";

const ETAG = "ETag";

/** Writes the version parameter, the `ETag` header of an `If-Match` version, and `concurrency.derivedFrom`. */
export function deriveWireConcurrency(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const concurrency = route.operation.concurrency;

  if (concurrency === undefined) return;

  const resource = resourceOf(route.node);
  const from = [deriveWireOriginAt(scope, `${resource.pointer}/concurrency`)];

  if (route.node.pointer !== resource.pointer && Object.hasOwn(route.node.settings, "concurrency"))
    from.push(deriveWireOriginAt(scope, `${route.node.pointer}/concurrency`));

  const derivedFrom: IrWriter.DerivedFrom = { derivation: CONCURRENCY, from };

  concurrency.derivedFrom = pipelineCopy(derivedFrom);

  const { version, field } = concurrency;

  if (version.in !== "query" && version.in !== "header") return;

  const name = version.name;

  if (name === undefined)
    throw new Error(`tree.nodes wrote a ${version.in} version without its name on '${route.id}'`);

  if (version.in === "header" && name.toLowerCase() === IF_MATCH) {
    writeEntityTag(route, name, derivedFrom, scope);

    return;
  }

  deriveWireAddParam(
    route,
    version.in,
    { name, type: fieldType(resource, field, scope), required: true, derivedFrom },
    scope,
  );
}

function writeEntityTag(
  route: DeriveWireRoute,
  name: string,
  derivedFrom: IrWriter.DerivedFrom,
  scope: DeriveWireScope,
): void {
  const derived = (header: string): DeriveWireDerived => ({
    name: header,
    type: DERIVE_WIRE_STRING_USE,
    required: true,
    derivedFrom,
  });

  deriveWireAddParam(route, "header", derived(name), scope);
  deriveWireAddSuccessHeader(route, derived(ETAG), undefined, scope);
}

// The collection or single declaring the version: the owner of an op, else the route's nearest one.
function resourceOf(node: TreeNode): TreeNode {
  let resource: TreeNode | undefined = node.kind === "op" ? treeNodesOpOwner(node) : node.parent;

  while (resource !== undefined && resource.kind !== "collection" && resource.kind !== "single")
    resource = resource.parent;

  if (resource === undefined)
    throw new Error(`tree.nodes wrote a concurrency on ${node.pointer}, which has no resource`);

  return resource;
}

function fieldType(resource: TreeNode, field: string, scope: DeriveWireScope): IrWriter.TypeUse {
  const item = scope.context.treeSchemas.typeUse(`${resource.pointer}/item`, "output");
  const schemas = scope.draft.schemas;
  const schema =
    item?.kind === "ref" && Object.hasOwn(schemas, item.schema) ? schemas[item.schema] : undefined;
  const property =
    schema?.kind === "object"
      ? schema.properties.find((candidate) => candidate.name === field)
      : undefined;

  if (property === undefined)
    throw new Error(
      `the item of ${resource.pointer} has no property '${field}', which tree.schemas checks`,
    );

  return property.type;
}
