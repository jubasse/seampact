import type { IrWriter } from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";
import { pipelineCopy, type ResolvedConventions, type TreeNode } from "../../../pipeline/seam.js";
import type { TreeNodesOperationName } from "../nodes/index.js";
import { treeNodesOpOwner } from "../nodes/names.js";
import type { TreeSchemasCompiler } from "./compile.js";
import {
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasPointer,
} from "./raw.js";

// The input schemas an operation derives (ADR 0006 section 3): the ids input of a `batch` op (derivation
// `batch.read`), and the version property a body version source adds to a versioned write's input schema
// (derivation `concurrency.version`). Both run once every route position is compiled.

const BATCH_OP = "batch";
const VERSIONED_OPS = new Set(["update", "delete"]);
const BODY_SOURCE = /^body\.(.+)$/;
const INHERIT = "inherit";

const property = (
  name: string,
  type: IrWriter.TypeUse,
  origin: IrWriter.Origin,
  derivedFrom: IrWriter.DerivedFrom,
): IrWriter.Property => ({
  name,
  type,
  optional: false,
  nullable: false,
  sensitive: false,
  deprecated: false,
  docs: {},
  extensions: {},
  origin,
  derivedFrom,
});

/** Writes the ids input of each `batch` op without a declared `input`, and its use at the op entry. */
export function treeSchemasCompileBatchInputs(
  compiler: TreeSchemasCompiler,
  nodes: readonly TreeNode[],
  names: ReadonlyMap<string, TreeNodesOperationName>,
  conventions: ResolvedConventions,
): void {
  for (const node of nodes) {
    const operation = names.get(node.pointer)?.name;

    if (node.kind !== "op" || node.name !== BATCH_OP || operation === undefined) continue;

    if (Object.hasOwn(node.settings, "input")) continue;
    const ids = batchIds(compiler, node, conventions);

    if (ids !== undefined)
      compiler.derivedObject([ids], node.pointer, deriveName(operation.segments, "input"));
  }
}

function batchIds(
  compiler: TreeSchemasCompiler,
  node: TreeNode,
  conventions: ResolvedConventions,
): IrWriter.Property | undefined {
  const reporter = compiler.reporter;
  const collection = treeNodesOpOwner(node);
  const idType = collection === undefined ? undefined : idTypeOf(compiler, collection);
  const written = node.settings.maxIds;
  const convention = conventions.get("batch.maxIds");
  const maxIds = typeof written === "number" ? written : convention?.value;

  if (idType === undefined || typeof maxIds !== "number") {
    reporter.error({
      rule: "batch-ids",
      pointer: node.pointer,
      message:
        idType === undefined
          ? "the batch op reads its records by id, and its collection has no single id parameter"
          : "the batch op sets no 'maxIds', and 'conventions.batch.maxIds' is not set",
      fix:
        idType === undefined
          ? "give the collection one id parameter, or declare the op's 'input'"
          : "set 'maxIds' on the op, or 'conventions.batch.maxIds'",
    });

    return undefined;
  }

  const origin =
    typeof written === "number"
      ? reporter.origin(treeSchemasPointer(node.pointer, "maxIds"))
      : convention?.origin;

  if (origin === undefined)
    throw new Error("conventions.batch.maxIds has no core default, so it is written");

  return property(
    "ids",
    { kind: "array", items: structuredClone(idType), maxItems: maxIds },
    pipelineCopy(origin),
    {
      derivation: "batch.read",
      from: [reporter.origin(node.pointer)],
    },
  );
}

// The type of a collection's one id parameter: the entry of its `id` fields map, or the one property of the
// object schema it names.
function idTypeOf(
  compiler: TreeSchemasCompiler,
  collection: TreeNode,
): IrWriter.TypeUse | undefined {
  const id = collection.settings.id;
  const pointer = treeSchemasPointer(collection.pointer, "id");

  if (treeSchemasIsObject(id)) {
    const entries = treeSchemasEntries(id);
    const [only] = entries;

    return entries.length === 1 && only !== undefined
      ? compiler.uses.get(treeSchemasPointer(pointer, only[0]))
      : undefined;
  }

  const properties = compiler.objectProperties(compiler.uses.get(pointer));

  return properties?.length === 1 ? properties[0]?.type : undefined;
}

/** A versioned write: where its version is read and the item property it is compared with. */
interface Version {
  /** The version property of a body source; undefined for a query or header source. */
  readonly property: string | undefined;
  readonly field: string;
  /** The collection or single that writes `concurrency`. */
  readonly owner: TreeNode;
  /** The route's own `concurrency: inherit`, a source of the version property too. */
  readonly inherited: string | undefined;
}

interface BodyRoute {
  readonly pointer: string;
  readonly version: Version | undefined;
}

// ADR 0002 section 6: `update` and `delete` take their resource's `concurrency`; a member route only with
// `concurrency: inherit`.
function versionOf(node: TreeNode): Version | undefined {
  const owner =
    node.kind === "op"
      ? VERSIONED_OPS.has(node.name)
        ? treeNodesOpOwner(node)
        : undefined
      : node.settings.concurrency === INHERIT
        ? versionedAncestor(node)
        : undefined;
  const concurrency = owner?.settings.concurrency;

  if (owner === undefined || !treeSchemasIsObject(concurrency)) return undefined;
  const { version, field } = concurrency;

  if (typeof version !== "string" || typeof field !== "string") return undefined;

  const inherited =
    node.kind === "op" ? undefined : treeSchemasPointer(node.pointer, "concurrency");

  return { property: BODY_SOURCE.exec(version)?.[1], field, owner, inherited };
}

function versionedAncestor(node: TreeNode): TreeNode | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (treeSchemasIsObject(at.settings.concurrency)) return at;
  }

  return undefined;
}

/**
 * Adds the version property of a body version source to the input schema of each versioned write, after its
 * authored properties. An input schema shared by routes that do not agree on that property is refused.
 */
export function treeSchemasCompileVersionProperties(
  compiler: TreeSchemasCompiler,
  nodes: readonly TreeNode[],
  names: ReadonlyMap<string, TreeNodesOperationName>,
): void {
  const routesBySchema = new Map<string, BodyRoute[]>();

  for (const node of nodes) checkVersionField(compiler, node);

  for (const node of nodes) {
    if (node.kind === "relay" || !names.has(node.pointer)) continue;
    const pointer = treeSchemasPointer(node.pointer, "input");
    const use = compiler.uses.get(pointer);
    const version = versionOf(node);

    if (use === undefined) continue;

    if (use.kind !== "ref" || compiler.objectProperties(use) === undefined) {
      if (version?.property !== undefined) refuseNonObjectInput(compiler.reporter, pointer);
      continue;
    }

    routesBySchema.set(use.schema, [
      ...(routesBySchema.get(use.schema) ?? []),
      { pointer, version },
    ]);
  }

  for (const [schema, routes] of routesBySchema) addVersionProperty(compiler, schema, routes);
}

function refuseNonObjectInput(reporter: TreeSchemasReporter, pointer: string): void {
  reporter.error({
    rule: "concurrency-version",
    pointer,
    message: "a body version source adds its property to the input, which is not an object schema",
    fix: "make the input an object schema, or read the version from the query or a header",
  });
}

function addVersionProperty(
  compiler: TreeSchemasCompiler,
  schema: string,
  routes: readonly BodyRoute[],
): void {
  const versioned = routes.find((route) => route.version?.property !== undefined);
  const version = versioned?.version;

  if (versioned === undefined || version?.property === undefined) return;
  const reporter = compiler.reporter;
  const other = routes.find(
    (route) =>
      route.version?.property !== version.property || route.version?.field !== version.field,
  );

  if (other !== undefined) {
    reporter.error({
      rule: "concurrency-version",
      pointer: versioned.pointer,
      message: `the input schema '${schema}' is used by a route that adds '${version.property}' to it and by one that does not add the same`,
      fix: "declare two schemas, one for each route",
      related: [{ pointer: other.pointer, message: `this route uses '${schema}' too` }],
    });

    return;
  }

  const sharedAt = useOutsideInputs(compiler, schema, routes);

  if (sharedAt !== undefined) {
    reporter.error({
      rule: "concurrency-version",
      pointer: versioned.pointer,
      message: `the input schema '${schema}' is used outside the inputs of its versioned routes, which would all take '${version.property}'`,
      fix: "declare a schema for the input of the versioned routes alone",
      related: [{ pointer: sharedAt, message: `'${schema}' is used here too` }],
    });

    return;
  }

  const properties = compiler.objectProperties({ kind: "ref", schema });

  if (properties === undefined)
    throw new Error(`tree.schemas collected '${schema}' as no object input`);
  const declared = properties.find((candidate) => candidate.name === version.property);

  if (declared !== undefined) {
    reporter.error({
      rule: "concurrency-version",
      pointer: versioned.pointer,
      message: `the input schema '${schema}' declares '${version.property}', which 'concurrency' adds`,
      fix: "remove it; 'concurrency' adds it",
    });

    return;
  }

  const type = fieldType(compiler, version);

  if (type === undefined) return;
  const origin = reporter.origin(
    treeSchemasPointer(version.owner.pointer, "concurrency", "version"),
  );

  properties.push(
    property(version.property, type, origin, {
      derivation: "concurrency.version",
      from: [
        pipelineCopy(origin),
        ...routes.flatMap(({ version: { inherited } = {} }) =>
          inherited === undefined ? [] : [reporter.origin(inherited)],
        ),
      ],
    }),
  );
}

// Where a schema is used besides the inputs of the given routes: another schema position, or a schema
// that refers to it. Undefined when those inputs are its only uses.
function useOutsideInputs(
  compiler: TreeSchemasCompiler,
  schema: string,
  routes: readonly BodyRoute[],
): string | undefined {
  const own = new Set([treeSchemasPointer("/schemas", schema), ...routes.map((route) => route.pointer)]);

  for (const [pointer, use] of compiler.uses) {
    if (!own.has(pointer) && refersToSchema(use, schema)) return pointer;
  }

  for (const [id, written] of compiler.schemas) {
    if (refersToSchema(written, schema))
      return compiler.writtenAt.get(id) ?? treeSchemasPointer("/schemas", id);
  }

  return undefined;
}

// A ref type use and a union variant both name their schema in a `schema` member.
function refersToSchema(value: unknown, schema: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => refersToSchema(entry, schema));

  if (typeof value !== "object" || value === null) return false;

  if ("schema" in value && value.schema === schema) return true;

  return Object.values(value).some((entry) => refersToSchema(entry, schema));
}

// Grammar section 6: the item of a `concurrency` owner has the property `field`, whatever the version source.
function checkVersionField(compiler: TreeSchemasCompiler, owner: TreeNode): void {
  const concurrency = owner.settings.concurrency;

  if (!treeSchemasIsObject(concurrency) || typeof concurrency.field !== "string") return;
  const field = concurrency.field;
  const itemPointer = treeSchemasPointer(owner.pointer, "item");

  // A written item that did not compile is reported where it is written.
  if (Object.hasOwn(owner.settings, "item") && !compiler.uses.has(itemPointer)) return;

  if (itemProperty(compiler, owner, field) !== undefined) return;
  compiler.reporter.error({
    rule: "concurrency-field",
    pointer: treeSchemasPointer(owner.pointer, "concurrency", "field"),
    message: `the item has no property '${field}' to compare the version with`,
    fix: "name a property of the item schema in 'field'",
  });
}

function itemProperty(
  compiler: TreeSchemasCompiler,
  owner: TreeNode,
  field: string,
): IrWriter.Property | undefined {
  const item = compiler.uses.get(treeSchemasPointer(owner.pointer, "item"));

  return compiler.objectProperties(item)?.find((candidate) => candidate.name === field);
}

// The version is typed like the item property it is compared with; a missing one is reported per owner.
function fieldType(compiler: TreeSchemasCompiler, version: Version): IrWriter.TypeUse | undefined {
  const field = itemProperty(compiler, version.owner, version.field);

  return field === undefined ? undefined : pipelineCopy(field.type);
}
