import type { IrWriter } from "@seampact/spec/ir";
import { type DerivationRoleName, derivationTable } from "../../../derivations/index.js";
import { finalizeCompareText } from "../../../finalize/canonical-order.js";
import {
  type DraftIR,
  pipelineCopy,
  pipelineRateLimitParam,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { type TreeNodesRawSchemas, treeNodesIdParam } from "../../tree/nodes/index.js";
import {
  type DeriveErrorsAttachedCode,
  deriveErrorsAttached,
  deriveErrorsIdentityAttached,
} from "./attached.js";
import {
  type DeriveErrorsBinding,
  type DeriveErrorsBindingCheck,
  type DeriveErrorsBoundParams,
  deriveErrorsBindingAt,
  deriveErrorsBindingKey,
  deriveErrorsCheckConditionalDatum,
  deriveErrorsParamsSite,
} from "./bindings.js";
import { deriveErrorsOriginOf } from "./read.js";
import { DERIVE_ERRORS_RELAY_DERIVATION, type DeriveErrorsRelayCode } from "./relays.js";
import { deriveErrorsCheckRetryParam } from "./retry-param.js";
import { deriveErrorsReadRoleParams } from "./role-params.js";
import {
  type DeriveErrorsRoute,
  deriveErrorsRejectsInputField,
  deriveErrorsTriggers,
} from "./triggers.js";

// Per operation `errors` (ADR 0006 sections 5 and 6, IR section 7): the attached codes and the derived ones, each code
// once (one element per code, `derivedFrom` the first derivation in table order
// with every trigger's origins, then the origins of the bindings that chose the code; an attached code keeps the
// origin of the node that attached it). A role trigger answers the code its nearest binding names, written with the
// role and the binding's params template (`roles`); a bucket rule's 429 carries the retry header of
// `conventions.rateLimit` (`retryHeader`). Elements are sorted by status, then code (`docs/ir/09`).

const TABLE_ORDER = new Map(derivationTable.map((row, index) => [row.id, index]));
const PACK_ROW_ORDER = TABLE_ORDER.get("pack.<pack>.<entry>") ?? derivationTable.length;
const BUCKET_DERIVATION = "rule.bucket";
const RATE_LIMITED_STATUS = 429;
const RETRY_UNITS: readonly IrWriter.RetryUnit[] = ["s", "ms"];

/** What the per-operation writer reads. */
export interface DeriveErrorsOperationsSources extends DeriveErrorsBindingCheck {
  readonly draft: DraftIR;
  readonly bound: DeriveErrorsBoundParams;
  /** The domain codes each relay route copies, by operation id. */
  readonly relayCodes: ReadonlyMap<string, readonly DeriveErrorsRelayCode[]>;
}

interface PendingError {
  readonly code: IrWriter.ErrorCode;
  readonly derivations: Map<string, IrWriter.Origin[]>;
  readonly bindingOrigins: IrWriter.Origin[];
  readonly roles: Map<DerivationRoleName, IrWriter.Template | undefined>;
  attached?: DeriveErrorsAttachedCode;
  relayed?: DeriveErrorsRelayCode;
  bucketFrom?: IrWriter.Origin[];
}

const tableIndexOf = (derivation: string): number => TABLE_ORDER.get(derivation) ?? PACK_ROW_ORDER;

/** Every operation of the draft with its tree node, matched by the origin pointer tree.nodes sets. */
export function deriveErrorsRoutes(
  sources: Pick<DeriveErrorsOperationsSources, "context" | "draft">,
): DeriveErrorsRoute[] {
  const nodes = new Map(pipelineTreeNodes(sources.context.raw).map((node) => [node.pointer, node]));

  return sources.draft.operations.map((operation) => {
    const pointer = operation.origin?.pointer;
    const node = pointer === undefined ? undefined : nodes.get(pointer);

    if (operation.id === undefined || node === undefined)
      throw new Error(
        `tree.nodes wrote an operation (${operation.id ?? "no id"}) whose origin ${pointer ?? "(none)"} is no tree node`,
      );

    return { id: operation.id, node, operation };
  });
}

// The member ids of the path of a route below one or more `member` scopes that no scope of the operation reads.
function unreadMemberIds(route: DeriveErrorsRoute, schemas: TreeNodesRawSchemas): string[] {
  const read = new Set(
    (route.operation.scopes ?? []).flatMap((scope) =>
      "in" in scope.source && scope.source.in === "path" && "name" in scope.source
        ? [scope.source.name]
        : [],
    ),
  );
  const inPath = new Set((route.operation.params?.path ?? []).map((param) => param.name));
  const unread: string[] = [];

  for (let node: TreeNode | undefined = route.node; node !== undefined; node = node.parent) {
    if (node.kind !== "scope" || node.name !== "member" || node.parent === undefined) continue;

    const idParam = treeNodesIdParam(node.parent, schemas);

    if (idParam !== undefined && inPath.has(idParam) && !read.has(idParam)) unread.push(idParam);
  }

  return unread;
}

function pendingOf(pending: Map<IrWriter.ErrorCode, PendingError>, code: string): PendingError {
  const existing = pending.get(code);

  if (existing !== undefined) return existing;

  const created: PendingError = {
    code,
    derivations: new Map(),
    bindingOrigins: [],
    roles: new Map(),
  };

  pending.set(code, created);

  return created;
}

function addFrom(error: PendingError, derivation: string, from: readonly IrWriter.Origin[]): void {
  const origins = error.derivations.get(derivation) ?? [];

  origins.push(...from);
  error.derivations.set(derivation, origins);
}

// The params a binding writes: its checked outcome, else (a default binding nobody redeclares) the by-name template,
// which reports nothing. Undefined when the code declares no params or the binding was refused.
function bindingParams(
  sources: DeriveErrorsOperationsSources,
  binding: DeriveErrorsBinding,
): IrWriter.Template | undefined {
  const checked = sources.bound.get(deriveErrorsBindingKey(binding));

  if (checked !== undefined) return checked.refused ? undefined : checked.params;

  const site = deriveErrorsParamsSite(sources, binding, binding.pointer ?? "");

  if (site === undefined) return undefined;

  const read = deriveErrorsReadRoleParams(site);

  return read.refused ? undefined : read.params;
}

// `forbidden`'s pointer is required where a restricted input field is rejected: checked once per binding.
function checkForbiddenPointer(
  sources: DeriveErrorsOperationsSources,
  route: DeriveErrorsRoute,
  binding: DeriveErrorsBinding,
  checked: Set<string>,
): void {
  const key = deriveErrorsBindingKey(binding);
  const pointer = binding.pointer ?? sources.registry.get(binding.code)?.pointer;

  // A default binding to the core code carries the pointer by name; one refused already reported its fault.
  if (pointer === undefined || checked.has(key) || sources.bound.get(key)?.refused === true) return;

  checked.add(key);

  const site = deriveErrorsParamsSite(sources, binding, pointer);
  const datum = site?.role.data.find((candidate) => candidate.required === "conditional");

  if (site === undefined || datum === undefined) return;

  deriveErrorsCheckConditionalDatum(sources, site, bindingParams(sources, binding), datum, {
    id: route.id,
    pointer: route.node.pointer,
  });
}

function bindingOrigin(
  sources: DeriveErrorsOperationsSources,
  binding: DeriveErrorsBinding,
): IrWriter.Origin | undefined {
  return binding.pointer === undefined
    ? undefined
    : deriveErrorsOriginOf(sources.context, binding.pointer);
}

function retryHeaderOf(
  sources: DeriveErrorsOperationsSources,
  code: IrWriter.ErrorCode,
  refusedParams: Map<string, boolean>,
  from: readonly IrWriter.Origin[],
): IrWriter.RetryHeader | undefined {
  const name = sources.context.conventions.get("rateLimit.header")?.value;
  const written = sources.context.conventions.get("rateLimit.unit")?.value;
  const unit = RETRY_UNITS.find((candidate) => candidate === written);
  const param = pipelineRateLimitParam(sources.context.conventions);

  if (typeof name !== "string" || unit === undefined || param === undefined) return undefined;

  // A param that cannot render as a safe integer is refused (once per code) and the code carries no header.
  if (!deriveErrorsCheckRetryParam(sources, refusedParams, code, param)) return undefined;

  return { name, param, unit, derivedFrom: { derivation: BUCKET_DERIVATION, from: [...from] } };
}

function elementOf(
  sources: DeriveErrorsOperationsSources,
  error: PendingError,
  refusedRetryParams: Map<string, boolean>,
): IrWriter.OperationError {
  const derivations = [...error.derivations.entries()].sort(
    ([left], [right]) => tableIndexOf(left) - tableIndexOf(right),
  );
  const first = derivations[0];

  if (first === undefined) throw new Error(`error ${error.code} was collected with no derivation`);

  const triggerOrigins = dedupe(derivations.flatMap(([, origins]) => origins)).sort(
    compareOrigins(sources),
  );
  const roles = [...error.roles.entries()]
    .sort(([left], [right]) => finalizeCompareText(left, right))
    .map(([role, params]) => (params === undefined ? { role } : { role, params }));
  const status = sources.registry.get(error.code)?.declaration.http.status;
  const retryHeader =
    error.bucketFrom !== undefined && status === RATE_LIMITED_STATUS
      ? retryHeaderOf(sources, error.code, refusedRetryParams, dedupe(error.bucketFrom))
      : undefined;
  const { attached, relayed } = error;
  const example = attached?.example ?? relayed?.example;
  const origin = attached?.origin ?? relayed?.origin;

  return pipelineCopy({
    code: error.code,
    ...(example === undefined ? {} : { example }),
    ...(roles.length === 0 ? {} : { roles }),
    ...(retryHeader === undefined ? {} : { retryHeader }),
    derivedFrom: {
      derivation: first[0],
      from: [...triggerOrigins, ...dedupe(error.bindingOrigins)],
    },
    ...(origin === undefined ? {} : { origin }),
  });
}

const originKey = (origin: IrWriter.Origin): string =>
  `${origin.api ?? ""}\u0000${origin.layer}\u0000${origin.pointer}`;

function dedupe(origins: readonly IrWriter.Origin[]): IrWriter.Origin[] {
  const seen = new Map<string, IrWriter.Origin>();

  for (const origin of origins)
    if (!seen.has(originKey(origin))) seen.set(originKey(origin), origin);

  return [...seen.values()];
}

// `docs/ir/09`: trigger origins by api (absent first), layer in the workspace's layer order, then pointer.
function compareOrigins(
  sources: DeriveErrorsOperationsSources,
): (left: IrWriter.Origin, right: IrWriter.Origin) => number {
  const layers: readonly string[] = sources.context.raw.layers.map((entry) => entry.layer);
  const layerIndex = (origin: IrWriter.Origin): number => layers.indexOf(origin.layer);

  return (left, right) => {
    if ((left.api ?? "") !== (right.api ?? ""))
      return finalizeCompareText(left.api ?? "", right.api ?? "");

    if (layerIndex(left) !== layerIndex(right)) return layerIndex(left) - layerIndex(right);

    return finalizeCompareText(left.pointer, right.pointer);
  };
}

function collect(
  sources: DeriveErrorsOperationsSources,
  route: DeriveErrorsRoute,
  forbiddenChecked: Set<string>,
): Map<IrWriter.ErrorCode, PendingError> {
  const pending = new Map<IrWriter.ErrorCode, PendingError>();
  const triggers = deriveErrorsTriggers(
    {
      draft: sources.draft,
      unreadMemberIds: unreadMemberIds(route, sources.context.raw.merged.schemas),
    },
    route,
  );

  for (const trigger of triggers.roles) {
    const binding = deriveErrorsBindingAt(sources.context, route.node, trigger.role);

    // An unregistered bound code is reported at its binding (`role-code`); no element names it.
    if (!sources.registry.has(binding.code)) continue;

    const error = pendingOf(pending, binding.code);
    const origin = bindingOrigin(sources, binding);

    addFrom(error, trigger.derivation, trigger.from);

    if (origin !== undefined) error.bindingOrigins.push(origin);

    if (trigger.derivation === BUCKET_DERIVATION)
      error.bucketFrom = [...(error.bucketFrom ?? []), ...trigger.from];

    if (!error.roles.has(trigger.role))
      error.roles.set(trigger.role, bindingParams(sources, binding));

    if (trigger.role === "forbidden" && deriveErrorsRejectsInputField(route.operation))
      checkForbiddenPointer(sources, route, binding, forbiddenChecked);
  }

  for (const trigger of triggers.codes) {
    const error = pendingOf(pending, trigger.code);

    addFrom(error, trigger.derivation, trigger.from);

    if (trigger.derivation === BUCKET_DERIVATION)
      error.bucketFrom = [...(error.bucketFrom ?? []), ...trigger.from];
  }

  // A copied domain code keeps the roles the public operation bound it to (the declarations are the same).
  for (const relayed of sources.relayCodes.get(route.id) ?? []) {
    const error = pendingOf(pending, relayed.code);

    addFrom(error, DERIVE_ERRORS_RELAY_DERIVATION, relayed.from);
    error.relayed = relayed;

    for (const binding of relayed.roles ?? [])
      if (!error.roles.has(binding.role)) error.roles.set(binding.role, binding.params);
  }

  for (const attached of deriveErrorsAttached(sources.context, route)) {
    const error = pendingOf(pending, attached.code);

    addFrom(error, attached.derivation, attached.from);
    error.attached = attached;
  }

  // An identity's listed code keeps its list entry as origin unless a node attached it too (the node's origin wins).
  for (const listed of deriveErrorsIdentityAttached(sources.context, route)) {
    const error = pendingOf(pending, listed.code);

    addFrom(error, listed.derivation, listed.from);

    if (error.attached?.origin === undefined) error.attached = listed;
  }

  return pending;
}

function registeredStatus(sources: DeriveErrorsOperationsSources, code: string): number {
  const registered = sources.registry.get(code);

  if (registered === undefined) throw new Error(`error ${code} is not in the registry`);

  return registered.declaration.http.status;
}

/** Writes `errors` on every operation of the draft. */
export function deriveErrorsOperations(sources: DeriveErrorsOperationsSources): void {
  const routes = deriveErrorsRoutes(sources);
  const forbiddenChecked = new Set<string>();
  const refusedRetryParams = new Map<string, boolean>();

  for (const route of routes) {
    const pending = collect(sources, route, forbiddenChecked);
    const statusOf = (code: string): number => registeredStatus(sources, code);
    // A listed or attached code nobody declares is reported by the registry (`error-unknown`); no element names it.
    const elements = [...pending.values()]
      .filter((error) => sources.registry.has(error.code))
      .map((error) => elementOf(sources, error, refusedRetryParams))
      .sort(
        (left, right) =>
          statusOf(left.code) - statusOf(right.code) || finalizeCompareText(left.code, right.code),
      );

    route.operation.errors = elements;
  }
}
