import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy, pipelineIsJsonObject, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesOpOwner } from "../../tree/nodes/index.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddParam,
  deriveWireAddResponseHeader,
  deriveWireSuccessResponses,
} from "./params.js";
import {
  type DeriveWireRelayed,
  deriveWireRelayedDerivedFrom,
  deriveWireRelayedOf,
} from "./relayed.js";
import { type DeriveWireRoute, type DeriveWireScope, deriveWireOriginAt } from "./routes.js";

// The version a write compares (`concurrency.version`, A33, ADR 0006 section 5). tree.nodes wrote `version` and
// `field`, a body source on a DELETE without input already read from the query. A body source is the version
// property tree.schemas added to the input, so only `derivedFrom` is written here; a query or header source is a
// required parameter typed like `field` on the resource's item. `header.If-Match` sends a strong entity tag instead:
// the `If-Match` parameter and the `ETag` header of every success response carrying the item, on every operation of
// the resource, are strings (RFC 9110 section 8.8.3), the tag computed from `field`. `from` names the resource's `concurrency`, then the route's `concurrency: inherit`.
// A relay route has no resource of its own: its version parameter and `ETag` headers are those the public
// operation derived, with that operation's `from`.

const CONCURRENCY = "concurrency.version";

const IF_MATCH = "if-match";

/** The entity tag response header of a versioned item and of `cache.etag`. */
export const DERIVE_WIRE_ETAG = "ETag";

/** Writes the version parameter, the `ETag` header of an `If-Match` version, and `concurrency.derivedFrom`. */
export function deriveWireConcurrency(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const relayed = deriveWireRelayedOf(route, scope);

  if (relayed !== undefined) {
    deriveRelayedConcurrency(route, relayed, scope);

    return;
  }

  const concurrency = route.operation.concurrency;

  writeItemEntityTag(route, scope);

  if (concurrency === undefined) return;

  const resource = resourceOf(route.node);

  if (resource === undefined)
    throw new Error(
      `tree.nodes wrote a concurrency on ${route.node.pointer}, which has no resource`,
    );

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
    deriveWireAddParam(
      route,
      "header",
      { name, type: DERIVE_WIRE_STRING_USE, required: true, derivedFrom },
      scope,
    );

    return;
  }

  deriveWireAddParam(
    route,
    version.in,
    { name, ...versionParam(resource, field, scope), required: true, derivedFrom },
    scope,
  );
}

function deriveRelayedConcurrency(
  route: DeriveWireRoute,
  relayed: DeriveWireRelayed,
  scope: DeriveWireScope,
): void {
  writeRelayedEntityTags(route, relayed, scope);

  const concurrency = route.operation.concurrency;

  if (concurrency === undefined) return;

  const publicDerivedFrom = relayed.operation.concurrency?.derivedFrom;

  if (publicDerivedFrom === undefined)
    throw new Error(
      `operation '${route.id}' relays an operation of ${relayed.api} whose concurrency has no derivedFrom`,
    );

  const derivedFrom = deriveWireRelayedDerivedFrom(publicDerivedFrom, relayed.api);

  concurrency.derivedFrom = pipelineCopy(derivedFrom);

  const version = concurrency.version;

  if (version.in !== "query" && version.in !== "header") return;

  const place = version.in;
  const param = relayed.operation.params?.[place].find(
    (candidate) =>
      candidate.name === version.name && candidate.derivedFrom?.derivation === CONCURRENCY,
  );

  if (param === undefined)
    throw new Error(
      `operation '${route.id}' relays an operation of ${relayed.api} without its ${place} version parameter`,
    );

  deriveWireAddParam(
    route,
    place,
    {
      name: param.name,
      type: pipelineCopy(param.type),
      ...(param.wire === undefined ? {} : { wire: pipelineCopy(param.wire) }),
      required: true,
      derivedFrom,
    },
    scope,
  );
}

// Each success response of the relay route carries the `ETag` the same response of the public operation carries.
function writeRelayedEntityTags(
  route: DeriveWireRoute,
  relayed: DeriveWireRelayed,
  scope: DeriveWireScope,
): void {
  for (const response of deriveWireSuccessResponses(route)) {
    const publicHeader = relayed.operation.responses
      ?.find((candidate) => candidate.status === response.status)
      ?.headers.find(
        (header) =>
          header.name === DERIVE_WIRE_ETAG && header.derivedFrom?.derivation === CONCURRENCY,
      );

    if (publicHeader?.derivedFrom === undefined) continue;

    const derived: DeriveWireDerived = {
      name: DERIVE_WIRE_ETAG,
      type: DERIVE_WIRE_STRING_USE,
      required: true,
      derivedFrom: deriveWireRelayedDerivedFrom(publicHeader.derivedFrom, relayed.api),
    };

    deriveWireAddResponseHeader(route, response, derived, undefined, scope);
  }
}

// Under a resource versioned by `If-Match`, every success response carrying its item writes the `ETag`, on the
// write and on every read of the resource alike.
function writeItemEntityTag(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const resource = resourceOf(route.node);
  const declared = resource?.settings.concurrency;

  if (resource === undefined || !pipelineIsJsonObject(declared)) return;

  const version = declared.version;

  if (typeof version !== "string" || version.toLowerCase() !== `header.${IF_MATCH}`) return;

  const item = itemSchemaOf(resource, scope);
  const derived: DeriveWireDerived = {
    name: DERIVE_WIRE_ETAG,
    type: DERIVE_WIRE_STRING_USE,
    required: true,
    derivedFrom: {
      derivation: CONCURRENCY,
      from: [deriveWireOriginAt(scope, `${resource.pointer}/concurrency`)],
    },
  };

  for (const response of deriveWireSuccessResponses(route))
    if (response.shape === "item" && response.body?.kind === "ref" && response.body.schema === item)
      deriveWireAddResponseHeader(route, response, derived, undefined, scope);
}

// The collection or single declaring the version: the owner of an op, else the route's nearest one.
function resourceOf(node: TreeNode): TreeNode | undefined {
  let resource: TreeNode | undefined = node.kind === "op" ? treeNodesOpOwner(node) : node.parent;

  while (resource !== undefined && resource.kind !== "collection" && resource.kind !== "single")
    resource = resource.parent;

  return resource;
}

function itemSchemaOf(resource: TreeNode, scope: DeriveWireScope): string | undefined {
  const item = scope.context.treeSchemas.typeUse(`${resource.pointer}/item`, "output");

  return item?.kind === "ref" ? item.schema : undefined;
}

// The version parameter: typed like `field`, a query one with the wire tree.schemas gives that property.
function versionParam(
  resource: TreeNode,
  field: string,
  scope: DeriveWireScope,
): Pick<DeriveWireDerived, "type" | "wire"> {
  const item = itemSchemaOf(resource, scope);
  const schemas = scope.draft.schemas;
  const schema = item !== undefined && Object.hasOwn(schemas, item) ? schemas[item] : undefined;
  const property =
    schema?.kind === "object"
      ? schema.properties.find((candidate) => candidate.name === field)
      : undefined;

  if (schema === undefined || property === undefined)
    throw new Error(
      `the item of ${resource.pointer} has no property '${field}', which tree.schemas checks`,
    );

  const wire = scope.context.treeSchemas.queryWire(`${schema.origin.pointer}/properties/${field}`);

  return { type: property.type, ...(wire === undefined ? {} : { wire }) };
}
