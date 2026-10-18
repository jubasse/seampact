import type { IrWriter, Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin } from "../../../diagnostics/diagnostic.js";
import {
  type DraftOperation,
  type InheritedEntry,
  pipelineCanonical,
  pipelineCopy,
  pipelineParseDuration,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { treeNodesIsCalendarDate } from "./calendar-date.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { TREE_NODES_BATCH_OP, treeNodesOpShorthand } from "./names.js";
import {
  TREE_NODES_MATURITIES,
  type TreeNodesContext,
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
export function treeNodesBudgetMs(site: TreeNodesSite): number | undefined {
  const isBatch = treeNodesOpShorthand(site.node) === TREE_NODES_BATCH_OP;
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

/** The nearest `deprecated` whose dates hold; its successor is checked once every operation is written. */
export function treeNodesDeprecated(site: TreeNodesSite): IrWriter.Deprecation | undefined {
  const entry = site.context.inherited(site.node, "deprecated")?.entry;

  if (entry === undefined) return undefined;

  const since = treeNodesMember(entry.value, "since");
  const sunset = treeNodesMember(entry.value, "sunset");
  const successor = treeNodesMember(entry.value, "successor");
  const api = site.draft.api?.id;
  const datesHold = deprecationDatesHold(site, entry.origin, since, sunset);

  if (!datesHold || typeof sunset !== "string") return undefined;

  if (api === undefined) throw new Error("write the api before its operations");

  return {
    sunset,
    ...(typeof successor === "string"
      ? { successor: { kind: "httpOperation" as const, api, id: successor } }
      : {}),
    origin: pipelineCopy(entry.origin),
  };
}

// Each refusal is reported once per written `deprecated`, however many operations inherit it.
function deprecationDatesHold(
  site: TreeNodesSite,
  origin: Origin,
  since: unknown,
  sunset: unknown,
): boolean {
  const sinceHolds = sinceIsDate(site, origin, since);
  const sunsetHolds = sunsetIsDate(site, origin, sunset);

  if (!sinceHolds || !sunsetHolds) return false;

  if (typeof since !== "string" || typeof sunset !== "string" || since <= sunset) return true;

  reportDeprecation(site, origin, {
    rule: "deprecated-since",
    member: "since",
    message: `The deprecation that reaches ${site.operationId} starts on ${since}, after its sunset ${sunset}.`,
    fix: "Write a since date on or before the sunset date.",
  });

  return false;
}

function sinceIsDate(site: TreeNodesSite, origin: Origin, since: unknown): boolean {
  if (typeof since !== "string") {
    reportDeprecation(site, origin, {
      rule: "deprecated-since",
      message: `The deprecation that reaches ${site.operationId} gives no since date.`,
      fix: DEPRECATION_FIX,
    });

    return false;
  }

  if (treeNodesIsCalendarDate(since)) return true;

  reportDeprecation(site, origin, {
    rule: "deprecated-since",
    member: "since",
    message: `The since date ${since} of the deprecation that reaches ${site.operationId} is no calendar day.`,
    fix: "Write since as a day that exists, as '2026-12-31'.",
  });

  return false;
}

function sunsetIsDate(site: TreeNodesSite, origin: Origin, sunset: unknown): boolean {
  if (typeof sunset !== "string") {
    reportDeprecation(site, origin, {
      rule: "deprecated-sunset",
      message: `The deprecation that reaches ${site.operationId} gives no sunset date.`,
      fix: DEPRECATION_FIX,
    });

    return false;
  }

  if (treeNodesIsCalendarDate(sunset)) return true;

  reportDeprecation(site, origin, {
    rule: "deprecated-sunset",
    member: "sunset",
    message: `The sunset date ${sunset} of the deprecation that reaches ${site.operationId} is no calendar day.`,
    fix: "Write sunset as a day that exists, as '2027-06-30'.",
  });

  return false;
}

const DEPRECATION_FIX = "Write deprecated: { since: '<date>', sunset: '<date>' }.";

interface DeprecationRefusal {
  rule: "deprecated-since" | "deprecated-sunset";
  /** The member the refusal points at; absent, the refusal points at `deprecated`. */
  member?: "since" | "sunset";
  message: string;
  fix: string;
}

function reportDeprecation(site: TreeNodesSite, origin: Origin, refusal: DeprecationRefusal): void {
  const pointer =
    refusal.member === undefined ? origin.pointer : `${origin.pointer}/${refusal.member}`;

  site.once(
    `${refusal.rule}:${origin.layer}#${pointer}`,
    treeNodesError({
      rule: refusal.rule,
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? origin),
      message: refusal.message,
      fix: refusal.fix,
    }),
  );
}

/** A deprecated operation whose successor names no operation of the api, or one its path params cannot fill. */
export function treeNodesCheckSuccessor(
  context: TreeNodesContext,
  operation: DraftOperation,
  operations: readonly DraftOperation[],
): void {
  const { id, deprecated } = operation;
  const successorId = deprecated?.successor?.id;

  if (id === undefined || deprecated === undefined || successorId === undefined) return;
  const pointer = `${deprecated.origin.pointer}/successor`;
  const origin = treeNodesNodeOrigin(context.origin(pointer) ?? deprecated.origin);
  const successor = operations.find((candidate) => candidate.id === successorId);

  if (successor !== undefined) {
    reportSuccessorParams(context, origin, operation, successor);

    return;
  }

  context.report(
    treeNodesError({
      rule: "deprecated-successor",
      origin,
      message: `The successor ${successorId} of ${id} is no operation of the api.`,
      fix: "Name the operation id of the route that replaces this one.",
    }),
  );
}

// The successor link is built from the deprecated request's path params, so each path param of the successor
// must be one of them, of the same type use.
function reportSuccessorParams(
  context: TreeNodesContext,
  origin: DiagnosticOrigin,
  operation: DraftOperation,
  successor: DraftOperation,
): void {
  const ownPathParams = operation.params?.path ?? [];

  for (const param of successor.params?.path ?? []) {
    const own = ownPathParams.find((candidate) => candidate.name === param.name);

    if (own !== undefined && sameTypeUse(own.type, param.type)) continue;

    const why =
      own === undefined
        ? `which ${operation.id} has not`
        : `typed otherwise than on ${operation.id}`;

    context.report(
      treeNodesError({
        rule: "deprecated-successor-params",
        origin,
        message: `The successor ${successor.id} of ${operation.id} has the path param ${param.name}, ${why}.`,
        fix: `Name a successor whose path params are path params of ${operation.id}, of the same type.`,
      }),
    );
  }
}

// Docs, examples and origin say where and how a use is written, not what it accepts.
const UNCOMPARED_TYPE_USE_MEMBERS: ReadonlySet<string> = new Set(["docs", "examples", "origin"]);

function sameTypeUse(own: IrWriter.TypeUse, successor: IrWriter.TypeUse): boolean {
  const compared = (use: IrWriter.TypeUse) =>
    Object.fromEntries(
      Object.entries(use).filter(([key]) => !UNCOMPARED_TYPE_USE_MEMBERS.has(key)),
    );

  return pipelineCanonical(compared(own)) === pipelineCanonical(compared(successor));
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

  return extensionsOf(values);
}

/** The extension values written on one mapping (the `api` block). */
export function treeNodesOwnExtensions(written: TreeNodesJson | undefined): IrWriter.Extensions {
  const values = new Map<string, Map<string, unknown>>();

  addExtensions(written, values);

  return extensionsOf(values);
}

const extensionsOf = (values: Map<string, Map<string, unknown>>): IrWriter.Extensions =>
  Object.fromEntries([...values].map(([prefix, keys]) => [prefix, Object.fromEntries(keys)]));

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
