import type { HalfName } from "../pipeline/halves.js";
import { derivationFreeze } from "./freeze.js";
import type { DerivationRoleName } from "./roles.js";

// ADR 0006 section 5 as data: every derivation id, what triggers it, what it derives, and the role its codes
// answer. The derive pass applies it, targets render its results and never re-derive (ADR 0006 section 5).
// The owner column `wire` says which half writes every element a derivation adds to the draft other than its
// codes (parameters, responses, response headers, input members, requirements, field rights, sort-key rights,
// operation members); `null` means it adds none. The field-ownership table reads it to own an element by its
// `derivedFrom.derivation` (`pipeline/ownership.ts`). The codes a derivation answers need no column: every
// `operations[].errors` element is derive.errors' (its ownership row), whatever derivation added it.
//
// After merge this is a shared file (INDEX rules): a new row is a lead or seam PR that carries the ADR 0006
// change, and the `derivation table matches ADR 0006` test compares it with the ADR.

/** The roles a derivation answers: role names, the codes the declaration itself names, or none. */
export type DerivationRoles = readonly DerivationRoleName[] | "declared" | "none";

export interface DerivationRow {
  /** The derivation id carried by `derivedFrom.derivation`; the pack row is `pack.<pack>.<entry>`. */
  readonly id: string;
  readonly trigger: string;
  readonly derived: string;
  readonly roles: DerivationRoles;
  readonly wire: HalfName | null;
}

/** The id pattern of a pack derivation entry (ADR 0008): `pack.<pack>.<entry>`. */
export const PACK_DERIVATION_ROW = "pack.<pack>.<entry>";

const row = (
  id: string,
  trigger: string,
  derived: string,
  roles: DerivationRoleName[] | "declared" | "none",
  wire: HalfName | null,
): DerivationRow => ({ id, trigger, derived, roles, wire });

/** Every row of ADR 0006 section 5, in the ADR's order. */
export const derivationTable: readonly DerivationRow[] = derivationFreeze([
  row(
    "input.invalid",
    "any input, or a refused undeclared query key",
    "400",
    ["schemaInvalid"],
    null,
  ),
  row(
    "body.limit",
    "a request body",
    "input.bodyLimitBytes, 413",
    ["payloadTooLarge"],
    "derive.wire",
  ),
  row("body.media", "a request body", "415 for another media", ["unsupportedMediaType"], null),
  row(
    "identity.authenticate",
    "identity or optional access",
    "the credential parameters of the accepted schemes, 401",
    ["unauthenticated"],
    "derive.wire",
  ),
  row(
    "csrf.cookieWrite",
    "a non-safe operation whose write schemes include a cookie scheme declaring csrf",
    "the CSRF header parameter, 403",
    ["csrfInvalid"],
    "derive.wire",
  ),
  row(
    "idempotency.write",
    "a non-safe operation when conventions.idempotency lists its method",
    "the key header parameter, the replay response header, 422, 409",
    ["idempotencyKeyReused", "idempotencyInProgress", "schemaInvalid"],
    "derive.wire",
  ),
  row(
    "concurrency.version",
    "update, delete or concurrency: inherit on a versioned resource",
    "the query or header version parameter (tree adds a body source's property), ETag, 409, 412, 428",
    ["stateConflict", "preconditionFailed", "preconditionRequired"],
    "derive.wire",
  ),
  row(
    "member.notFound",
    "a member route whose member id no scope of the operation reads",
    "404",
    ["notFound"],
    null,
  ),
  row(
    "owner.caller",
    "a member route of a collection with owner: caller",
    "404",
    ["notFound"],
    null,
  ),
  row("principal.requires", "principal.requires", "403", ["forbidden"], null),
  row("binding.mismatch", "bindings", "403", ["forbidden"], null),
  row("requirement.errors", "each requirement", "the right's or rule's codes", "declared", null),
  row(
    "scope.errors",
    "each scope of the operation",
    "the scope's membership codes",
    "declared",
    null,
  ),
  row(
    "fieldRight.restricted",
    "a restrictedTo property reachable from the input or output of a route that is not a relay",
    "a fieldRights entry per pointer and direction; 403 on a rejected input",
    ["forbidden"],
    "access.rights",
  ),
  row(
    "sortKey.restricted",
    "a sortable key with a right",
    "the key's right, 403",
    ["sortKeyForbidden"],
    "access.rights",
  ),
  row(
    "rule.proof",
    "a requirement on a rule with proof",
    "the proof field added once to the input",
    "none",
    "access.rights",
  ),
  row(
    "rule.bucket",
    "a requirement with bucket",
    "the rule's codes, the retry header on 429",
    ["rateLimited"],
    "derive.wire",
  ),
  row(
    "identity.header",
    "each identity header for the operation's direction",
    "request parameters and response headers",
    "none",
    "derive.wire",
  ),
  row(
    "identity.deadline",
    "a deadline identity header",
    "deadlineHeader, 504",
    ["deadlineExceeded"],
    "derive.wire",
  ),
  row(
    "identity.versionToken",
    "a versionToken identity header",
    "the response header on every success, the optional request header on writes, the stale code",
    "declared",
    "derive.wire",
  ),
  row(
    "signed.identity",
    "a signed identity",
    "input.rawBody, no CSRF, no idempotency key, 401",
    ["unauthenticated"],
    "access.identity",
  ),
  row(
    "identity.unknownKeys",
    "a signed identity with unknownKeys",
    "unknownKeys on the input of each of its routes",
    "none",
    "access.identity",
  ),
  row(
    "input.unknownKeys",
    "conventions.input.unknownKeys other than refuse",
    "unknownKeys on every body input use that sets none",
    "none",
    "derive.wire",
  ),
  row(
    "union.headerTag",
    "a route whose input is a header-tagged union",
    "the required tag header parameter, 400",
    ["schemaInvalid"],
    "derive.wire",
  ),
  row(
    "cache.headers",
    "cache on a GET",
    "Cache-Control per caller kind, Vary",
    "none",
    "derive.wire",
  ),
  row("cache.etag", "cache.etag", "ETag, If-None-Match, a 304 response", "none", "derive.wire"),
  row(
    "cache.sensitive",
    "a response holding a sensitive field on a route with no cache or freshness: never",
    "cache.noStore",
    "none",
    "derive.wire",
  ),
  row(
    "paging.params",
    "a list with a paging style",
    "the style's request parameters, the sort parameter, the page response shape, 400",
    ["schemaInvalid"],
    "derive.wire",
  ),
  row("paging.gone", "a paging style with a since role", "410", ["gone"], null),
  row(
    "batch.read",
    "the batch op",
    "safe, the ids input, the table shape, batch defaults",
    "none",
    "tree.nodes",
  ),
  row("budget.timeout", "budget", "budgetMs", "none", "tree.nodes"),
  row(
    "deprecation.headers",
    "deprecated",
    "the deprecation, sunset and successor Link response headers",
    "none",
    "derive.wire",
  ),
  row("upstream.maturity", "upstream", "maturity from the owning service", "none", "derive.wire"),
  row(
    "relay.route",
    "a relay route",
    "the public operation's shape and its domain codes with their declarations",
    "declared",
    "tree.nodes",
  ),
  row(
    "api.gateway",
    "api.role: gateway",
    "502, 503, 504 on every operation",
    ["upstreamUnavailable", "serviceUnavailable", "upstreamTimeout"],
    null,
  ),
  row("api.service", "api.kind: service", "504 on every operation", ["deadlineExceeded"], null),
  row("response.undeclared", "every operation", "500", ["undeclaredStatus"], null),
  row(
    "response.format",
    "every response but a download or a redirect",
    "the format reference and shape",
    "none",
    "tree.nodes",
  ),
  row(
    "response.download",
    "a file response body",
    "Content-Type, Content-Disposition",
    "none",
    "derive.wire",
  ),
  row(
    "redirect.location",
    "a redirect status in responses",
    "the required Location header",
    "none",
    "derive.wire",
  ),
  row("conventions.every", "conventions.errors.every", "the attached codes", "declared", null),
  row(
    "node.errors",
    "errors on a tree node",
    "the codes it declares or attaches",
    "declared",
    null,
  ),
  row(
    PACK_DERIVATION_ROW,
    "a pack derivation entry",
    "a right, a requirement or attached codes",
    "declared",
    "access.rights",
  ),
]);

const BY_ID = new Map(derivationTable.map((entry) => [entry.id, entry]));

// A pack entry id: `pack.` then a pack name and an entry name, neither empty. The pack name may hold dots
// (`@seampact/pack-crud-rights` does not, a local pack name might), so the entry is the last segment. The shape
// only: that the pack is one the api loaded (`draft.packs`) is for access.rights to check where it writes one.
const PACK_ENTRY = /^pack\.[^.\s]+(?:\.[^.\s]+)*\.[^.\s]+$/;

/** True for a derivation id of the table, or a pack entry id `pack.<pack>.<entry>`. */
export function isDerivationId(id: string): boolean {
  if (id === PACK_DERIVATION_ROW) return false;

  return BY_ID.has(id) || PACK_ENTRY.test(id);
}

/** The row of a derivation id; a pack entry id resolves to the `pack.<pack>.<entry>` row. */
export function derivationRowOf(id: string): DerivationRow | undefined {
  if (id === PACK_DERIVATION_ROW) return undefined;

  if (BY_ID.has(id)) return BY_ID.get(id);

  return PACK_ENTRY.test(id) ? BY_ID.get(PACK_DERIVATION_ROW) : undefined;
}
