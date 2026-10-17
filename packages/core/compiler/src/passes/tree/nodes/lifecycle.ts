import type { IrWriter, Origin } from "@seampact/spec/ir";
import {
  type InheritedEntry,
  pipelineCopy,
  pipelineParseDuration,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import {
  TREE_NODES_MATURITIES,
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
} from "./raw.js";

// The lifecycle settings of an operation (ADR 0002 sections 8 and 10): `budget`, `deprecated`, `upstream`, a stated
// `maturity`, `internal` and `tags`, each read through the inherited settings with the origin of the node that set
// it, and the consumer extension keys, the nearest of each winning (ADR 0002 section 12).

const SERVICE_API: IrWriter.ApiKind = "service";
const STATED: IrWriter.MaturitySource = "stated";
const BATCH_BUDGET = "batch.budget";

// `x-<prefix>-<key>` (ADR 0002 section 12): the prefix holds no dash, so the key is everything after it.
const EXTENSION_KEY = /^x-([a-z][a-z0-9]*)-(.+)$/;

/** `budget` in milliseconds: the nearest, else `conventions.batch.budget` for a batch. */
export function treeNodesBudgetMs(site: TreeNodesSite, isBatch: boolean): number | undefined {
  const entry = site.context.inherited(site.node, "budget")?.entry;
  const reading = isBatch ? site.context.conventions.get(BATCH_BUDGET) : undefined;
  const written = entry?.value ?? reading?.value;
  const origin = entry?.origin ?? reading?.origin;

  if (written === undefined) return undefined;

  const budgetMs = typeof written === "string" ? pipelineParseDuration(written) : undefined;

  if (budgetMs !== undefined) return budgetMs;

  if (origin === undefined)
    throw new Error(`the core budget of ${site.operationId} does not parse`);
  site.once(
    `budget-duration:${origin.layer}#${origin.pointer}`,
    treeNodesError({
      rule: "budget-duration",
      origin: treeNodesNodeOrigin(origin),
      message: `The budget ${String(written)} of ${site.operationId} is too long to hold in milliseconds.`,
      fix: "Write a shorter budget.",
    }),
  );

  return undefined;
}

/** The nearest `deprecated`; its successor is checked once every operation id is known. */
export function treeNodesDeprecated(site: TreeNodesSite): IrWriter.Deprecation | undefined {
  const entry = site.context.inherited(site.node, "deprecated")?.entry;

  if (entry === undefined) return undefined;

  const sunset = treeNodesMember(entry.value, "sunset");
  const successor = treeNodesMember(entry.value, "successor");
  const api = site.draft.api?.id;

  if (typeof sunset !== "string") {
    reportNoSunset(site, entry.origin);

    return undefined;
  }

  if (api === undefined) throw new Error("write the api before its operations");

  return {
    sunset,
    ...(typeof successor === "string"
      ? { successor: { kind: "httpOperation" as const, api, id: successor } }
      : {}),
    origin: pipelineCopy(entry.origin),
  };
}

function reportNoSunset(site: TreeNodesSite, origin: Origin): void {
  site.once(
    `deprecated-sunset:${origin.layer}#${origin.pointer}`,
    treeNodesError({
      rule: "deprecated-sunset",
      origin: treeNodesNodeOrigin(origin),
      message: `The deprecation that reaches ${site.operationId} gives no sunset date.`,
      fix: "Write deprecated: { sunset: '<date>' }.",
    }),
  );
}

/** A deprecated operation whose successor names no operation of the api. */
export function treeNodesCheckSuccessor(
  site: Pick<TreeNodesSite, "context" | "operationId">,
  deprecated: IrWriter.Deprecation,
  operationIds: ReadonlySet<string>,
): void {
  const successor = deprecated.successor?.id;

  if (successor === undefined || operationIds.has(successor)) return;
  const pointer = `${deprecated.origin.pointer}/successor`;

  site.context.report(
    treeNodesError({
      rule: "deprecated-successor",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? deprecated.origin),
      message: `The successor ${successor} of ${site.operationId} is no operation of the api.`,
      fix: "Name the operation id of the route that replaces this one.",
    }),
  );
}

/** The nearest `upstream`, each service declared in `services`. */
export function treeNodesUpstream(site: TreeNodesSite): string[] {
  const entry = site.context.inherited(site.node, "upstream")?.entry;

  if (entry === undefined || !Array.isArray(entry.value)) return [];

  const services = site.context.raw.merged.services;

  return entry.value.flatMap((service, index) => {
    if (typeof service !== "string")
      throw new Error(`the upstream at ${entry.origin.pointer} holds no service name`);

    if (!treeNodesIsObject(services) || !Object.hasOwn(services, service))
      reportUnknownService(site, service, entry, index);

    return [service];
  });
}

function reportUnknownService(
  site: TreeNodesSite,
  service: string,
  entry: InheritedEntry,
  index: number,
): void {
  const pointer = `${entry.origin.pointer}/${index}`;

  site.once(
    `upstream-service:${entry.origin.layer}#${pointer}`,
    treeNodesError({
      rule: "upstream-service",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? entry.origin),
      message: `The upstream service ${service} of ${site.operationId} is not declared in services.`,
      fix: `Declare ${service} in services, or name a declared service.`,
    }),
  );
}

/** A stated `maturity`, the nearest; derive.wire derives the others. */
export function treeNodesStatedMaturity(
  site: TreeNodesSite,
): IrWriter.OperationMaturity | undefined {
  const entry = site.context.inherited(site.node, "maturity")?.entry;

  if (entry === undefined) return undefined;

  const written = treeNodesIsObject(entry.value)
    ? treeNodesMember(entry.value, "level")
    : entry.value;
  const level = TREE_NODES_MATURITIES.find((candidate) => candidate === written);
  const reason = treeNodesMember(entry.value, "reason");

  if (level === undefined)
    throw new Error(`the maturity at ${entry.origin.pointer} is no level the grammar admits`);

  return {
    level,
    source: STATED,
    ...(typeof reason === "string" ? { reason } : {}),
    origin: pipelineCopy(entry.origin),
  };
}

/** The nearest `internal`, false when unset; a service api has no documents to keep a route out of. */
export function treeNodesInternal(site: TreeNodesSite): boolean {
  const entry = site.context.inherited(site.node, "internal")?.entry;

  if (entry === undefined) return false;

  if (site.draft.api?.kind === SERVICE_API) {
    site.once(
      `internal-product:${entry.origin.layer}#${entry.origin.pointer}`,
      treeNodesError({
        rule: "internal-product",
        origin: treeNodesNodeOrigin(entry.origin),
        message: `The service api ${site.draft.api.id} writes internal, which only a product api's documents read.`,
        fix: "Remove internal; a service api is internal as a whole.",
      }),
    );
  }

  return entry.value === true;
}

/** The union of the `tags` from the root down, each once. */
export function treeNodesTags(site: TreeNodesSite): string[] {
  const entries = site.context.inherited(site.node, "tags")?.entries ?? [];
  const tags = new Set<string>();

  for (const { value } of entries) {
    const written = Array.isArray(value) ? value : [value];

    for (const tag of written) if (typeof tag === "string") tags.add(tag);
  }

  return [...tags];
}

/** The extension values that reach a tree node, `{ <prefix>: { <key>: value } }`, the nearest of each key. */
export function treeNodesExtensions(node: TreeNode): IrWriter.Extensions {
  const chain: TreeNode[] = [];

  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) chain.unshift(at);

  const values = new Map<string, Map<string, unknown>>();

  for (const at of chain) addExtensions(at.settings, values);

  return Object.fromEntries(
    [...values].map(([prefix, keys]) => [prefix, Object.fromEntries(keys)]),
  );
}

/** The extension values written on one mapping (the `api` block). */
export function treeNodesOwnExtensions(written: TreeNodesJson | undefined): IrWriter.Extensions {
  const values = new Map<string, Map<string, unknown>>();

  addExtensions(written, values);

  return Object.fromEntries(
    [...values].map(([prefix, keys]) => [prefix, Object.fromEntries(keys)]),
  );
}

// tree.schemas has checked each value against its declaration (ADR 0008). The key may be `__proto__`, so the slot
// is built with `Object.fromEntries`, which defines own members only.
function addExtensions(
  written: TreeNodesJson | undefined,
  values: Map<string, Map<string, unknown>>,
): void {
  if (!treeNodesIsObject(written)) return;

  for (const [key, value] of Object.entries(written)) {
    const match = EXTENSION_KEY.exec(key);
    const prefix = match?.[1];
    const name = match?.[2];

    if (prefix === undefined || name === undefined) continue;
    const keys = values.get(prefix) ?? new Map<string, unknown>();

    keys.set(name, pipelineCopy(value));
    values.set(prefix, keys);
  }
}
