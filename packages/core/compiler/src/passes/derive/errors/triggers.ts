import type { IrWriter } from "@seampact/spec/ir";
import type { DerivationRoleName } from "../../../derivations/index.js";
import type { DraftIR, DraftOperation, TreeNode } from "../../../pipeline/seam.js";

// The derived error triggers of one operation (ADR 0006 section 5): each row of the derivation table whose trigger
// the operation meets, read from what tree.nodes, the access halves and derive.wire wrote on it. A row with roles
// gives a role trigger, bound to a code per operation later; a row with declared codes (a requirement's right or
// rule, a scope) gives its codes. `from` holds the trigger's origins; the binding's origin is added where the role is
// bound.

/** An operation of the draft with the tree node tree.nodes wrote it from. */
export interface DeriveErrorsRoute {
  readonly id: string;
  readonly node: TreeNode;
  readonly operation: DraftOperation;
}

/** A row that answers a role on the operation. */
export interface DeriveErrorsRoleTrigger {
  readonly derivation: string;
  readonly role: DerivationRoleName;
  readonly from: readonly IrWriter.Origin[];
}

/** A row that answers declared codes on the operation. */
export interface DeriveErrorsCodeTrigger {
  readonly derivation: string;
  readonly code: IrWriter.ErrorCode;
  readonly from: readonly IrWriter.Origin[];
}

export interface DeriveErrorsTriggers {
  readonly roles: DeriveErrorsRoleTrigger[];
  readonly codes: DeriveErrorsCodeTrigger[];
}

const GATEWAY_ROLES: readonly DerivationRoleName[] = [
  "upstreamUnavailable",
  "serviceUnavailable",
  "upstreamTimeout",
];
const IF_MATCH_SOURCE = "header";
const SINCE_ROLE = "since";
const REJECT_POLICY = "reject";
const BOUNDARY_ENFORCEMENT = "boundary";
const DERIVED_CSRF = "derived";
const SIGNED_IDENTITY = "signed";
const VERSION_TOKEN_DERIVATION = "identity.versionToken";

/** The parts of the draft the triggers read besides the operation. */
export interface DeriveErrorsTriggerSources {
  readonly draft: DraftIR;
  /** The member id parameters of the operation's path that no scope reads, from `deriveErrorsUnreadMemberIds`. */
  readonly unreadMemberIds: readonly string[];
}

function operationOrigin(route: DeriveErrorsRoute): IrWriter.Origin {
  const origin = route.operation.origin;

  if (origin === undefined)
    throw new Error(`tree.nodes wrote no origin on operation '${route.id}'`);

  return origin;
}

// A refused undeclared query key is an invalid input, so such an operation answers schemaInvalid
// even when it declares no input.
const hasInput = (operation: DraftOperation): boolean =>
  operation.input !== undefined ||
  operation.unknownQuery?.policy === "refuse" ||
  (operation.params !== undefined &&
    operation.params.path.length + operation.params.query.length + operation.params.header.length >
      0);

function accessRoles(
  sources: DeriveErrorsTriggerSources,
  route: DeriveErrorsRoute,
): DeriveErrorsRoleTrigger[] {
  const access = route.operation.access;

  if (access === undefined)
    throw new Error(`access.identity wrote no access on operation '${route.id}'`);

  if (access.kind !== "identity" && !(access.kind === "optional" && access.onRefused === "reject"))
    return [];

  const triggers: DeriveErrorsRoleTrigger[] = [
    { derivation: "identity.authenticate", role: "unauthenticated", from: [access.origin] },
  ];
  const identity = sources.draft.identities[access.identity];

  if (identity?.kind === SIGNED_IDENTITY)
    triggers.push({
      derivation: "signed.identity",
      role: "unauthenticated",
      from: [identity.origin],
    });

  return triggers;
}

function writeRoles(operation: DraftOperation): DeriveErrorsRoleTrigger[] {
  const triggers: DeriveErrorsRoleTrigger[] = [];
  const { csrf, idempotency, concurrency } = operation;

  if (csrf?.kind === DERIVED_CSRF && "derivedFrom" in csrf)
    triggers.push({
      derivation: "csrf.cookieWrite",
      role: "csrfInvalid",
      from: csrf.derivedFrom.from,
    });

  if (idempotency !== undefined && "derivedFrom" in idempotency) {
    const from = idempotency.derivedFrom.from;
    const derivation = "idempotency.write";

    if (idempotency.enforce === BOUNDARY_ENFORCEMENT)
      triggers.push(
        { derivation, role: "idempotencyKeyReused", from },
        { derivation, role: "idempotencyInProgress", from },
      );

    if (idempotency.required) triggers.push({ derivation, role: "schemaInvalid", from });
  }

  if (concurrency?.derivedFrom !== undefined) {
    const from = concurrency.derivedFrom.from;
    const derivation = "concurrency.version";

    if (concurrency.version.in === IF_MATCH_SOURCE)
      triggers.push(
        { derivation, role: "preconditionFailed", from },
        { derivation, role: "preconditionRequired", from },
      );
    else triggers.push({ derivation, role: "stateConflict", from });
  }

  return triggers;
}

function memberRoles(
  sources: DeriveErrorsTriggerSources,
  route: DeriveErrorsRoute,
): DeriveErrorsRoleTrigger[] {
  const triggers: DeriveErrorsRoleTrigger[] = [];
  const { operation } = route;

  if (sources.unreadMemberIds.length > 0)
    triggers.push({
      derivation: "member.notFound",
      role: "notFound",
      from: [operationOrigin(route)],
    });

  if (operation.owner?.kind === "caller")
    triggers.push({ derivation: "owner.caller", role: "notFound", from: [operation.owner.origin] });

  const principal = operation.principalRequires ?? [];

  if (principal.length > 0)
    triggers.push({
      derivation: "principal.requires",
      role: "forbidden",
      from: principal.map((entry) => entry.origin),
    });

  const bindings = operation.bindings ?? [];

  if (bindings.length > 0)
    triggers.push({
      derivation: "binding.mismatch",
      role: "forbidden",
      from: bindings.map((entry) => entry.origin),
    });

  return triggers;
}

const rejectedInputFields = (operation: DraftOperation): IrWriter.FieldRight[] =>
  (operation.fieldRights ?? []).filter(
    (right) => right.direction === "input" && right.inputPolicy === REJECT_POLICY,
  );

/** Whether an operation has a restricted input field whose rejection answers `forbidden`. */
export const deriveErrorsRejectsInputField = (operation: DraftOperation): boolean =>
  rejectedInputFields(operation).length > 0;

function rightRoles(operation: DraftOperation): DeriveErrorsRoleTrigger[] {
  const triggers: DeriveErrorsRoleTrigger[] = [];
  const rejected = rejectedInputFields(operation);

  if (rejected.length > 0)
    triggers.push({
      derivation: "fieldRight.restricted",
      role: "forbidden",
      from: rejected.flatMap((right) => right.derivedFrom.from),
    });

  const paging = operation.paging;

  if (paging?.sortKeys.some((key) => key.right !== undefined))
    triggers.push({
      derivation: "sortKey.restricted",
      role: "sortKeyForbidden",
      from: [paging.origin],
    });

  return triggers;
}

// The trigger is the `deadline` identity header: the origins derive.wire wrote it from, else the operation's.
function deadlineOrigins(route: DeriveErrorsRoute): readonly IrWriter.Origin[] {
  const header = route.operation.params?.header?.find(
    (param) => param.name === route.operation.deadlineHeader,
  );

  return header?.derivedFrom?.from ?? [operationOrigin(route)];
}

function wireRoles(
  sources: DeriveErrorsTriggerSources,
  route: DeriveErrorsRoute,
): DeriveErrorsRoleTrigger[] {
  const triggers: DeriveErrorsRoleTrigger[] = [];
  const { operation } = route;

  if (operation.deadlineHeader !== undefined)
    triggers.push({
      derivation: "identity.deadline",
      role: "deadlineExceeded",
      from: deadlineOrigins(route),
    });

  for (const param of operation.params?.header ?? [])
    if (param.derivedFrom?.derivation === "union.headerTag")
      triggers.push({
        derivation: "union.headerTag",
        role: "schemaInvalid",
        from: param.derivedFrom.from,
      });

  const paging = operation.paging;

  if (paging?.style === undefined) return triggers;

  triggers.push({ derivation: "paging.params", role: "schemaInvalid", from: [paging.origin] });

  const style = sources.draft.pagings[paging.style];

  if (style?.request.some((entry) => entry.role === SINCE_ROLE))
    triggers.push({ derivation: "paging.gone", role: "gone", from: [paging.origin] });

  return triggers;
}

function apiRoles(
  sources: DeriveErrorsTriggerSources,
  route: DeriveErrorsRoute,
): DeriveErrorsRoleTrigger[] {
  const api = sources.draft.api;

  if (api === undefined) throw new Error("tree.nodes wrote no api");

  const triggers: DeriveErrorsRoleTrigger[] = [];

  if (api.role === "gateway")
    for (const role of GATEWAY_ROLES)
      triggers.push({ derivation: "api.gateway", role, from: [api.origin] });

  if (api.kind === "service")
    triggers.push({ derivation: "api.service", role: "deadlineExceeded", from: [api.origin] });

  triggers.push({
    derivation: "response.undeclared",
    role: "undeclaredStatus",
    from: [operationOrigin(route)],
  });

  return triggers;
}

function requirementOrigins(requirement: IrWriter.Requirement): readonly IrWriter.Origin[] {
  if (requirement.origin !== undefined) return [requirement.origin];

  if (requirement.derivedFrom !== undefined) return requirement.derivedFrom.from;

  throw new Error(`access.rights wrote a requirement with neither origin nor derivedFrom`);
}

// A versionToken use's `stale` code, where derive.wire wrote its request header: on the writes of the identity.
function versionTokenCodes(
  sources: DeriveErrorsTriggerSources,
  operation: DraftOperation,
): DeriveErrorsCodeTrigger[] {
  const access = operation.access;

  if (access === undefined || access.kind === "public") return [];

  const uses = sources.draft.identities[access.identity]?.headers ?? [];
  const codes: DeriveErrorsCodeTrigger[] = [];

  for (const param of operation.params?.header ?? []) {
    if (param.derivedFrom?.derivation !== VERSION_TOKEN_DERIVATION) continue;

    const use = uses.find(
      (candidate) => sources.draft.headers[candidate.header]?.request === param.name,
    );

    if (use?.stale !== undefined)
      codes.push({
        derivation: VERSION_TOKEN_DERIVATION,
        code: use.stale,
        from: param.derivedFrom.from,
      });
  }

  return codes;
}

// A requirement's codes (`requirement.errors`), and a bucket rule's own `rule.bucket` row: its codes, or the
// `rateLimited` role when the rule declares none (ADR 0006 section 6).
function requirementTriggers(
  sources: DeriveErrorsTriggerSources,
  operation: DraftOperation,
): DeriveErrorsTriggers {
  const roles: DeriveErrorsRoleTrigger[] = [];
  const codes: DeriveErrorsCodeTrigger[] = [];

  for (const requirement of operation.requires ?? []) {
    const from = requirementOrigins(requirement);

    if (requirement.kind === "right") {
      const declared = sources.draft.rights[requirement.right]?.errors ?? [];

      for (const code of declared) codes.push({ derivation: "requirement.errors", code, from });

      continue;
    }

    const declared = sources.draft.rules[requirement.rule]?.errors ?? [];

    for (const code of declared) codes.push({ derivation: "requirement.errors", code, from });

    if (requirement.bucket === undefined) continue;

    if (declared.length === 0) roles.push({ derivation: "rule.bucket", role: "rateLimited", from });

    for (const code of declared) codes.push({ derivation: "rule.bucket", code, from });
  }

  for (const scope of operation.scopes ?? [])
    for (const code of sources.draft.scopes[scope.scope]?.errors ?? [])
      codes.push({ derivation: "scope.errors", code, from: [scope.origin] });

  return { roles, codes };
}

/** The derived triggers of one operation, in no particular order (the writer orders by the derivation table). */
export function deriveErrorsTriggers(
  sources: DeriveErrorsTriggerSources,
  route: DeriveErrorsRoute,
): DeriveErrorsTriggers {
  const { operation } = route;
  const roles: DeriveErrorsRoleTrigger[] = [];

  if (hasInput(operation))
    roles.push({
      derivation: "input.invalid",
      role: "schemaInvalid",
      from: [operationOrigin(route)],
    });

  if (operation.input !== undefined) {
    const from = [operation.input.origin];

    roles.push(
      { derivation: "body.limit", role: "payloadTooLarge", from },
      { derivation: "body.media", role: "unsupportedMediaType", from },
    );
  }

  const requirements = requirementTriggers(sources, operation);

  roles.push(
    ...accessRoles(sources, route),
    ...writeRoles(operation),
    ...memberRoles(sources, route),
    ...rightRoles(operation),
    ...requirements.roles,
    ...wireRoles(sources, route),
    ...apiRoles(sources, route),
  );

  return { roles, codes: [...requirements.codes, ...versionTokenCodes(sources, operation)] };
}
