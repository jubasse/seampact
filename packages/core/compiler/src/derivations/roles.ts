import type { IrWriter } from "@seampact/spec/ir";
import { canonicalId, splitName } from "@seampact/spec/naming";
import type { PassReadonly } from "../pipeline/readonly.js";
import { derivationFreeze } from "./freeze.js";

// ADR 0006 section 6 as data: every role, its default code with status and nature, and the data the boundary
// produces for it. The default codes form part of every api's registry, so a contract with no pack compiles
// (A34); the derive.errors half registers them and binds roles (A35). Each datum's `type` is the type use of
// the default code's param of that name.
//
// The params schemas of the default codes, the issue schema and the empty body schema below are core declarations
// (origin `core`, no `derivedFrom`) that tree.schemas seeds from this data; their ids, `derivationCoreSchemaIds`, are
// reserved (ADR 0004 section 13) and finalize drops the ones no element references. No half writes them yet.
//
// The data is deep-frozen and shared by every compile: a half writes a copy into its draft
// (`derivationCopy<IrWriter.TypeUse>(datum.type)`, a `structuredClone`), never the frozen value itself.

export type DerivationRoleName = IrWriter.ErrorRole;

/** Whether a datum must reach a param of the bound code (ADR 0006 section 6, the Data column). */
export type DerivationDatumRequired = "always" | "never" | "conditional";

export interface DerivationRoleDatum {
  readonly name: string;
  readonly required: DerivationDatumRequired;
  /** For `conditional`: when the datum is required, as the ADR states it. */
  readonly condition?: string;
  readonly type: PassReadonly<IrWriter.TypeUse>;
}

export interface DerivationRole {
  readonly role: DerivationRoleName;
  readonly defaultCode: IrWriter.ErrorCode;
  readonly status: number;
  readonly nature: IrWriter.NatureBase;
  readonly data: readonly DerivationRoleDatum[];
}

// Each call a new object, so no two data share one.
const text = (): IrWriter.ScalarTypeUse => ({ kind: "scalar", type: "string", refinements: {} });
const count = (): IrWriter.ScalarTypeUse => ({
  kind: "scalar",
  type: "integer",
  refinements: { minimum: "0" },
});

/** Where an issue of the `schemaInvalid` role sits in the request (ADR 0006 section 6). */
export type DerivationIssueLocation = "path" | "query" | "header" | "body";

/** The values of an issue's `in`, in the order of ADR 0006 section 6. */
export const derivationIssueLocations: readonly DerivationIssueLocation[] = derivationFreeze([
  "path",
  "query",
  "header",
  "body",
]);

// `in` as a closed set: a string matching one location. The pattern uses no construct ADR 0003 section 9
// normalises, so its normalised form is its written form.
const location = (): IrWriter.ScalarTypeUse => {
  const source = `^(?:${derivationIssueLocations.join("|")})$`;

  return {
    kind: "scalar",
    type: "string",
    refinements: { pattern: { source, normalized: source } },
  };
};

/**
 * The schema id of one item of the `schemaInvalid` role's `issues`: `{ in, pointer, rule }`, `in` one of
 * `derivationIssueLocations`.
 */
export const DERIVATION_ISSUE_SCHEMA_ID: IrWriter.SchemaId = "ApiSchemaInvalidIssue";

/** The members of one issue, in the order of ADR 0006 section 6. */
export const derivationIssueMembers: readonly {
  readonly name: string;
  readonly type: PassReadonly<IrWriter.TypeUse>;
}[] = derivationFreeze([
  { name: "in", type: location() },
  { name: "pointer", type: text() },
  { name: "rule", type: text() },
]);

const role = (
  name: DerivationRoleName,
  defaultCode: string,
  status: number,
  nature: IrWriter.NatureBase,
  data: DerivationRoleDatum[] = [],
): DerivationRole => ({ role: name, defaultCode, status, nature, data });

/** Every role of ADR 0006 section 6, in the ADR's order. */
export const derivationRoles: readonly DerivationRole[] = derivationFreeze([
  role("schemaInvalid", "api.schema_invalid", 400, "refused", [
    {
      name: "issues",
      required: "always",
      type: { kind: "array", items: { kind: "ref", schema: DERIVATION_ISSUE_SCHEMA_ID } },
    },
  ]),
  role("unauthenticated", "api.unauthenticated", 401, "refused"),
  role("forbidden", "api.forbidden", 403, "refused", [
    {
      name: "pointer",
      required: "conditional",
      condition: "on an operation with a rejected restricted input field, absent otherwise",
      type: text(),
    },
  ]),
  role("csrfInvalid", "api.csrf_invalid", 403, "refused"),
  role("sortKeyForbidden", "api.sort_key_forbidden", 403, "refused", [
    { name: "key", required: "always", type: text() },
  ]),
  role("notFound", "api.not_found", 404, "refused"),
  role("stateConflict", "state.conflict", 409, "refused"),
  role("idempotencyInProgress", "api.idempotency_in_progress", 409, "unavailable"),
  role("preconditionFailed", "api.precondition_failed", 412, "refused"),
  role("idempotencyKeyReused", "api.idempotency_key_reused", 422, "refused"),
  role("preconditionRequired", "api.precondition_required", 428, "refused"),
  role("gone", "api.cursor_too_old", 410, "refused"),
  role("payloadTooLarge", "api.payload_too_large", 413, "refused", [
    { name: "limitBytes", required: "never", type: count() },
  ]),
  role("unsupportedMediaType", "api.unsupported_media_type", 415, "refused"),
  role("rateLimited", "api.rate_limited", 429, "unavailable", [
    {
      name: "retryAfterMs",
      required: "conditional",
      condition: "when conventions.rateLimit names it",
      type: count(),
    },
  ]),
  role("undeclaredStatus", "api.internal", 500, "failed"),
  role("upstreamUnavailable", "api.upstream_unavailable", 502, "unavailable"),
  role("serviceUnavailable", "api.service_unavailable", 503, "unavailable"),
  role("upstreamTimeout", "api.upstream_timeout", 504, "unavailable"),
  role("deadlineExceeded", "api.deadline_exceeded", 504, "unavailable"),
]);

const BY_ROLE = new Map(derivationRoles.map((entry) => [entry.role, entry]));

/** The role of a name, with its default code. */
export const derivationRoleOf = (name: DerivationRoleName): DerivationRole | undefined =>
  BY_ROLE.get(name);

/** The schema id of a proof-only input's body: an object schema with no property (ADR 0004 section 13). */
export const DERIVATION_EMPTY_BODY_SCHEMA_ID: IrWriter.SchemaId = "ApiEmptyBody";

// The ADR 0007 params name of a default code: `api.rate_limited` gives `ApiRateLimitedParams`.
function paramsSchemaId(code: string): IrWriter.SchemaId {
  const id = canonicalId({ segments: splitName(code), role: "params" });

  if (id === undefined) throw new Error(`default code ${code} names no params schema`);

  return id;
}

/**
 * The reserved ids of the core schemas (ADR 0004 section 13), in its order: the params schema of each default code
 * that carries data, in the order of ADR 0006 section 6, then the issue schema and the empty body schema.
 */
export const derivationCoreSchemaIds: readonly IrWriter.SchemaId[] = derivationFreeze([
  ...derivationRoles
    .filter((entry) => entry.data.length > 0)
    .map((entry) => paramsSchemaId(entry.defaultCode)),
  DERIVATION_ISSUE_SCHEMA_ID,
  DERIVATION_EMPTY_BODY_SCHEMA_ID,
]);
