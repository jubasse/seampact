import type { IrWriter, Origin } from "@seampact/spec/ir";
import { type DraftConcurrency, pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { TREE_NODES_DELETE_OP, treeNodesOpOwner, treeNodesOpShorthand } from "./names.js";
import { treeNodesMember, treeNodesObjectOf, treeNodesSetting, treeNodesText } from "./raw.js";

// Write semantics (ADR 0002 section 6, FR-2): `owner: caller` on a collection or single, and the version a write
// compares (`concurrency`), which its `update` and `delete` ops inherit and a member route takes only with
// `concurrency: inherit`. The version parameter itself is derived later (derive.wire), and the version property
// of a body source is tree.schemas'.

const OWNER_CALLER: IrWriter.OwnerKind = "caller";
const INHERIT = "inherit";

// The ops that inherit the resource's concurrency.
const VERSIONED_OPS: readonly IrWriter.OpShorthand[] = ["update", "delete"];

const VERSION_SOURCE = /^(body|query|header)\.(.+)$/;

type VersionPlace = "body" | "query" | "header";

interface VersionSource {
  readonly in: VersionPlace;
  readonly name: string;
}

/** The collection or single an operation writes: the owner of its op, else its nearest one. */
function resourceNodeOf(node: TreeNode): TreeNode | undefined {
  if (node.kind === "op") return treeNodesOpOwner(node);

  for (let at = node.parent; at !== undefined; at = at.parent)
    if (at.kind === "collection" || at.kind === "single") return at;

  return undefined;
}

/** `owner: caller`, written on the collection or single the operation belongs to. */
export function treeNodesOwner(site: TreeNodesSite): IrWriter.Owner | undefined {
  const resource = resourceNodeOf(site.node);

  if (resource === undefined || treeNodesText(resource, "owner") !== OWNER_CALLER) return undefined;

  const origin = site.context.origin(`${resource.pointer}/owner`);

  if (origin === undefined)
    throw new Error(`the raw tree has no origin for ${resource.pointer}/owner`);

  return { kind: OWNER_CALLER, origin: pipelineCopy(origin) };
}

/**
 * The version an operation compares: its resource's `concurrency`, for an `update` or `delete` op, and for a member
 * route with `concurrency: inherit`. A delete without input reads a body source from the query (A33). The
 * resource's declaration itself is checked once, whichever of its operations take the version.
 */
export function treeNodesConcurrency(
  site: TreeNodesSite,
  input: IrWriter.TypeUse | undefined,
  params: IrWriter.Params,
): DraftConcurrency | undefined {
  const node = site.node;
  const op = treeNodesOpShorthand(node);
  const optsIn = treeNodesSetting(node, "concurrency") === INHERIT;

  checkDeclaration(site, resourceNodeOf(node));

  if (op !== undefined && !VERSIONED_OPS.includes(op)) return undefined;

  if (op === undefined && !optsIn) return undefined;

  const resource = resourceNodeOf(node);
  const declared = resource === undefined ? undefined : treeNodesSetting(resource, "concurrency");

  if (resource === undefined || declared === undefined) {
    if (optsIn) reportNothingToInherit(site, "declares no concurrency");

    return undefined;
  }

  if (optsIn && !onMemberScope(node, resource)) {
    reportNothingToInherit(site, "is not a member route of a collection");

    return undefined;
  }

  const source = parseSource(treeNodesMember(declared, "version"));
  const field = treeNodesMember(declared, "field");

  if (source === undefined || typeof field !== "string")
    throw new Error(
      `the concurrency of ${resource.pointer} has no version and field the grammar admits`,
    );

  checkNotRestated(site, source, input, params);

  const readsBodyWithoutOne =
    source.in === "body" && op === TREE_NODES_DELETE_OP && input === undefined;
  const version: IrWriter.ValueSource = readsBodyWithoutOne
    ? { in: "query", name: source.name }
    : { in: source.in, name: source.name };

  return { version, field };
}

// ADR 0002 section 6: a caller-owned record has no version. That `field` names an item property is tree.schemas'
// check, made where it adds the version.
function checkDeclaration(site: TreeNodesSite, resource: TreeNode | undefined): void {
  if (resource === undefined || treeNodesSetting(resource, "concurrency") === undefined) return;

  checkOwnerAlone(site, resource);
}

function parseSource(written: unknown): VersionSource | undefined {
  const match = typeof written === "string" ? VERSION_SOURCE.exec(written) : null;
  const place = match?.[1];
  const name = match?.[2];

  if (place !== "body" && place !== "query" && place !== "header") return undefined;

  return name === undefined ? undefined : { in: place, name };
}

// A collection's member routes take its version; a single's routes are its own members.
function onMemberScope(node: TreeNode, resource: TreeNode): boolean {
  if (resource.kind === "single") return true;

  for (let at = node.parent; at !== undefined && at !== resource; at = at.parent)
    if (at.kind === "scope" && at.parent === resource) return at.name === "member";

  return false;
}

function reportNothingToInherit(site: TreeNodesSite, why: string): void {
  const pointer = `${site.node.pointer}/concurrency`;

  site.context.report(
    treeNodesError({
      rule: "concurrency-inherit",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message: `The route ${site.operationId} writes concurrency: inherit, but it ${why}.`,
      fix: "Remove concurrency: inherit, or declare concurrency on the collection that owns the route.",
    }),
  );
}

function checkOwnerAlone(site: TreeNodesSite, resource: TreeNode): void {
  if (treeNodesText(resource, "owner") !== OWNER_CALLER) return;

  const at = (member: string) =>
    treeNodesNodeOrigin(site.context.origin(`${resource.pointer}/${member}`) ?? resource.origin);

  site.once(
    `owner-concurrency:${resource.pointer}`,
    treeNodesError({
      rule: "owner-concurrency",
      origin: at("concurrency"),
      message: `${resource.name} is owned by the caller and also declares concurrency; a caller-owned record has no version.`,
      fix: "Remove concurrency, or remove owner: caller.",
      related: [{ origin: at("owner"), message: "owner: caller" }],
    }),
  );
}

// ADR 0002 section 6: the compiler adds the version parameter, so an input or a parameter declaring it is an error,
// located at the field that declares it. A derived body property (tree.schemas adds it) carries `derivedFrom`; a
// declared one does not.
function checkNotRestated(
  site: TreeNodesSite,
  source: VersionSource,
  input: IrWriter.TypeUse | undefined,
  params: IrWriter.Params,
): void {
  const restated = restatingOrigin(site, source, input, params);

  if (restated === undefined) return;

  // A shared input schema restates the version for each of its operations at one pointer: reported once.
  site.once(
    `concurrency-input:${restated.layer}#${restated.pointer}`,
    treeNodesError({
      rule: "concurrency-input",
      origin: treeNodesNodeOrigin(restated),
      message: `The operation ${site.operationId} declares ${source.in}.${source.name}, the version its concurrency adds.`,
      fix: `Remove ${source.name} from the operation; concurrency adds it.`,
    }),
  );
}

function restatingOrigin(
  site: TreeNodesSite,
  source: VersionSource,
  input: IrWriter.TypeUse | undefined,
  params: IrWriter.Params,
): Origin | undefined {
  if (source.in === "query")
    return originOf(
      site,
      params.query.find((param) => param.name === source.name),
    );

  if (source.in === "header") {
    const name = source.name.toLowerCase();

    return originOf(
      site,
      params.header.find((param) => param.name.toLowerCase() === name),
    );
  }

  const [first] = source.name.split(".");
  const schema = treeNodesObjectOf(site.draft, input);

  return schema?.properties.find(
    (property) => property.name === first && property.derivedFrom === undefined,
  )?.origin;
}

const originOf = (site: TreeNodesSite, param: IrWriter.Param | undefined): Origin | undefined =>
  param === undefined ? undefined : (param.origin ?? site.node.origin);
