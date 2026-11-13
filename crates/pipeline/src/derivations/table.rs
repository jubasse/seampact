//! The derivation table of ADR 0006 section 5: every derivation id, what triggers it, what it
//! derives, the roles its codes answer and the half that writes the elements it adds.
//!
//! The table is immutable static data read by the derive pass and by the element-owner rule of
//! `merge_into`. The owner column `wire` names the half that writes every element a derivation
//! adds to the draft other than its codes; `None` means it adds none. The codes a derivation
//! answers need no column: every `operations[].errors` element is `derive.errors`'.

use seampact_ir::ErrorRole;
use seampact_js::is_ecmascript_white_space;

use crate::Half;

/// The roles a derivation answers: role names, the codes the declaration itself names, or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DerivationRoles {
    /// The roles it answers, in the ADR's order.
    Named(&'static [ErrorRole]),
    /// The codes the declaration itself names.
    Declared,
    /// No code.
    None,
}

/// One row of ADR 0006 section 5.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DerivationRow {
    /// The derivation id carried by `derivedFrom.derivation`; the pack row is `pack.<pack>.<entry>`.
    pub id: &'static str,
    /// What triggers the derivation.
    pub trigger: &'static str,
    /// What it derives.
    pub derived: &'static str,
    /// The roles its codes answer.
    pub roles: DerivationRoles,
    /// The half that writes the elements it adds, if it adds any.
    pub wire: Option<Half>,
}

/// The id pattern of a pack derivation entry (ADR 0008): `pack.<pack>.<entry>`.
pub const PACK_DERIVATION_ROW: &str = "pack.<pack>.<entry>";

const PACK_ENTRY_PREFIX: &str = "pack.";

const fn row(
    id: &'static str,
    trigger: &'static str,
    derived: &'static str,
    roles: DerivationRoles,
    wire: Option<Half>,
) -> DerivationRow {
    DerivationRow {
        id,
        trigger,
        derived,
        roles,
        wire,
    }
}

/// Every row of ADR 0006 section 5, in the ADR's order.
pub static DERIVATION_TABLE: &[DerivationRow] = &[
    row(
        "input.invalid",
        "any input, or a refused undeclared query key",
        "400",
        DerivationRoles::Named(&[ErrorRole::SchemaInvalid]),
        None,
    ),
    row(
        "body.limit",
        "a request body",
        "input.bodyLimitBytes, 413",
        DerivationRoles::Named(&[ErrorRole::PayloadTooLarge]),
        Some(Half::DeriveWire),
    ),
    row(
        "body.media",
        "a request body",
        "415 for another media",
        DerivationRoles::Named(&[ErrorRole::UnsupportedMediaType]),
        None,
    ),
    row(
        "identity.authenticate",
        "identity or optional access",
        "the credential parameters of the accepted schemes, 401",
        DerivationRoles::Named(&[ErrorRole::Unauthenticated]),
        Some(Half::DeriveWire),
    ),
    row(
        "csrf.cookieWrite",
        "a non-safe operation whose write schemes include a cookie scheme declaring csrf",
        "the CSRF header parameter, 403",
        DerivationRoles::Named(&[ErrorRole::CsrfInvalid]),
        Some(Half::DeriveWire),
    ),
    row(
        "idempotency.write",
        "a non-safe operation when conventions.idempotency lists its method",
        "the key header parameter, the replay response header, 422, 409",
        DerivationRoles::Named(&[
            ErrorRole::IdempotencyKeyReused,
            ErrorRole::IdempotencyInProgress,
            ErrorRole::SchemaInvalid,
        ]),
        Some(Half::DeriveWire),
    ),
    row(
        "concurrency.version",
        "update, delete or concurrency: inherit on a versioned resource",
        "the query or header version parameter (tree adds a body source's property), ETag, 409, 412, 428",
        DerivationRoles::Named(&[
            ErrorRole::StateConflict,
            ErrorRole::PreconditionFailed,
            ErrorRole::PreconditionRequired,
        ]),
        Some(Half::DeriveWire),
    ),
    row(
        "member.notFound",
        "a member route whose member id no scope of the operation reads",
        "404",
        DerivationRoles::Named(&[ErrorRole::NotFound]),
        None,
    ),
    row(
        "owner.caller",
        "a member route of a collection with owner: caller",
        "404",
        DerivationRoles::Named(&[ErrorRole::NotFound]),
        None,
    ),
    row(
        "principal.requires",
        "principal.requires",
        "403",
        DerivationRoles::Named(&[ErrorRole::Forbidden]),
        None,
    ),
    row(
        "binding.mismatch",
        "bindings",
        "403",
        DerivationRoles::Named(&[ErrorRole::Forbidden]),
        None,
    ),
    row(
        "requirement.errors",
        "each requirement",
        "the right's or rule's codes",
        DerivationRoles::Declared,
        None,
    ),
    row(
        "scope.errors",
        "each scope of the operation",
        "the scope's membership codes",
        DerivationRoles::Declared,
        None,
    ),
    row(
        "fieldRight.restricted",
        "a restrictedTo property reachable from the input or output of a route that is not a relay",
        "a fieldRights entry per pointer and direction; 403 on a rejected input",
        DerivationRoles::Named(&[ErrorRole::Forbidden]),
        Some(Half::AccessRights),
    ),
    row(
        "sortKey.restricted",
        "a sortable key with a right",
        "the key's right, 403",
        DerivationRoles::Named(&[ErrorRole::SortKeyForbidden]),
        Some(Half::AccessRights),
    ),
    row(
        "rule.proof",
        "a requirement on a rule with proof",
        "the proof field added once to the input",
        DerivationRoles::None,
        Some(Half::AccessRights),
    ),
    row(
        "rule.bucket",
        "a requirement with bucket",
        "the rule's codes, the retry header on 429",
        DerivationRoles::Named(&[ErrorRole::RateLimited]),
        Some(Half::DeriveWire),
    ),
    row(
        "identity.header",
        "each identity header for the operation's direction",
        "request parameters and response headers",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "identity.deadline",
        "a deadline identity header",
        "deadlineHeader, 504",
        DerivationRoles::Named(&[ErrorRole::DeadlineExceeded]),
        Some(Half::DeriveWire),
    ),
    row(
        "identity.versionToken",
        "a versionToken identity header",
        "the response header on every success, the optional request header on writes, the stale code",
        DerivationRoles::Declared,
        Some(Half::DeriveWire),
    ),
    row(
        "signed.identity",
        "a signed identity",
        "input.rawBody, no CSRF, no idempotency key, 401",
        DerivationRoles::Named(&[ErrorRole::Unauthenticated]),
        Some(Half::AccessIdentity),
    ),
    row(
        "identity.unknownKeys",
        "a signed identity with unknownKeys",
        "unknownKeys on the input of each of its routes",
        DerivationRoles::None,
        Some(Half::AccessIdentity),
    ),
    row(
        "input.unknownKeys",
        "conventions.input.unknownKeys other than refuse",
        "unknownKeys on every body input use that sets none",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "union.headerTag",
        "a route whose input is a header-tagged union",
        "the required tag header parameter, 400",
        DerivationRoles::Named(&[ErrorRole::SchemaInvalid]),
        Some(Half::DeriveWire),
    ),
    row(
        "cache.headers",
        "cache on a GET",
        "Cache-Control per caller kind, Vary",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "cache.etag",
        "cache.etag",
        "ETag, If-None-Match, a 304 response",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "cache.sensitive",
        "a response holding a sensitive field on a route with no cache or freshness: never",
        "cache.noStore",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "paging.params",
        "a list with a paging style",
        "the style's request parameters, the sort parameter, the page response shape, 400",
        DerivationRoles::Named(&[ErrorRole::SchemaInvalid]),
        Some(Half::DeriveWire),
    ),
    row(
        "paging.gone",
        "a paging style with a since role",
        "410",
        DerivationRoles::Named(&[ErrorRole::Gone]),
        None,
    ),
    row(
        "batch.read",
        "the batch op",
        "safe, the ids input, the table shape, batch defaults",
        DerivationRoles::None,
        Some(Half::TreeNodes),
    ),
    row(
        "budget.timeout",
        "budget",
        "budgetMs",
        DerivationRoles::None,
        Some(Half::TreeNodes),
    ),
    row(
        "deprecation.headers",
        "deprecated",
        "the deprecation, sunset and successor Link response headers",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "upstream.maturity",
        "upstream",
        "maturity from the owning service",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "relay.route",
        "a relay route",
        "the public operation's shape and its domain codes with their declarations",
        DerivationRoles::Declared,
        Some(Half::TreeNodes),
    ),
    row(
        "api.gateway",
        "api.role: gateway",
        "502, 503, 504 on every operation",
        DerivationRoles::Named(&[
            ErrorRole::UpstreamUnavailable,
            ErrorRole::ServiceUnavailable,
            ErrorRole::UpstreamTimeout,
        ]),
        None,
    ),
    row(
        "api.service",
        "api.kind: service",
        "504 on every operation",
        DerivationRoles::Named(&[ErrorRole::DeadlineExceeded]),
        None,
    ),
    row(
        "response.undeclared",
        "every operation",
        "500",
        DerivationRoles::Named(&[ErrorRole::UndeclaredStatus]),
        None,
    ),
    row(
        "response.format",
        "every response but a download or a redirect",
        "the format reference and shape",
        DerivationRoles::None,
        Some(Half::TreeNodes),
    ),
    row(
        "response.download",
        "a file response body",
        "Content-Type, Content-Disposition",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "redirect.location",
        "a redirect status in responses",
        "the required Location header",
        DerivationRoles::None,
        Some(Half::DeriveWire),
    ),
    row(
        "conventions.every",
        "conventions.errors.every",
        "the attached codes",
        DerivationRoles::Declared,
        None,
    ),
    row(
        "node.errors",
        "errors on a tree node",
        "the codes it declares or attaches",
        DerivationRoles::Declared,
        None,
    ),
    row(
        PACK_DERIVATION_ROW,
        "a pack derivation entry",
        "a right, a requirement or attached codes",
        DerivationRoles::Declared,
        Some(Half::AccessRights),
    ),
];

/// True for a derivation id of the table, or a pack entry id `pack.<pack>.<entry>`.
#[must_use]
pub fn is_derivation_id(id: &str) -> bool {
    if id == PACK_DERIVATION_ROW {
        return false;
    }

    DERIVATION_TABLE.iter().any(|entry| entry.id == id) || is_pack_entry(id)
}

/// The row of a derivation id; a pack entry id resolves to the `pack.<pack>.<entry>` row.
#[must_use]
pub fn derivation_row_of(id: &str) -> Option<&'static DerivationRow> {
    if id == PACK_DERIVATION_ROW {
        return None;
    }

    if let Some(entry) = DERIVATION_TABLE.iter().find(|entry| entry.id == id) {
        return Some(entry);
    }

    if is_pack_entry(id) {
        return DERIVATION_TABLE
            .iter()
            .find(|entry| entry.id == PACK_DERIVATION_ROW);
    }

    None
}

// A pack entry id: `pack.` then a pack name and an entry name, neither empty. The pack name may
// hold dots, so the entry is the last segment. The shape only: that the pack is one the api
// loaded is for access.rights to check where it writes one.
fn is_pack_entry(id: &str) -> bool {
    let Some(names) = id.strip_prefix(PACK_ENTRY_PREFIX) else {
        return false;
    };
    let mut segment_count = 0;

    for segment in names.split('.') {
        let is_plain = !segment.is_empty() && !segment.chars().any(is_ecmascript_white_space);

        if !is_plain {
            return false;
        }

        segment_count += 1;
    }

    segment_count >= 2
}
