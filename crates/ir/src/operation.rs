//! Operations and every definition they hold.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    Access, BucketId, CacheVisibility, CallerKind, Csrf, DeclarationKind, DerivedFrom, Direction,
    Docs, ErrorCode, ErrorRole, Extensions, Feature, FieldRightAlways, FieldWireKind, FormatId,
    HttpMethod, Idempotency, IdempotencyEnforcement, IdentityId, InputMediaType, InputPolicy,
    IrMap, Maturity, MaturitySource, Name, OpShorthand, OperationId, Origin, OverLimitPolicy,
    OwnerKind, PagingId, PagingToken, QueryStyle, QueryWireKind, Reason, RefusedCredential,
    Requirement, ResponseHeaderSemantic, ResponseShape, RetryUnit, RightId, RuleId, SchemaId,
    SchemeId, ScopeId, ServiceId, SurfaceId, Template, TypeUse, UnknownQuery, ValueSource,
    integers,
};

/// A kind-tagged operation reference (ADR 0014).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRef {
    /// The `kind` member.
    pub kind: DeclarationKind,

    /// The `api` member.
    pub api: String,

    /// The `id` member.
    pub id: OperationId,
}

/// The wire form of a query parameter (FR-30).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWire {
    /// The `kind` member.
    pub kind: QueryWireKind,

    /// The `style` member.
    pub style: QueryStyle,

    /// The `explode` member.
    pub explode: bool,

    /// A list sent as 'name[]'.
    pub brackets: bool,
}

/// The wire form of a form or multipart field: a query wire kind with style, explode and brackets, or kind 'file' or 'json' alone (invariant ir.field-wire.members).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldWire {
    /// The `kind` member.
    pub kind: FieldWireKind,

    /// The `style` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<QueryStyle>,

    /// The `explode` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explode: Option<bool>,

    /// The `brackets` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brackets: Option<bool>,
}

/// A path, query or header parameter, declared (origin) or derived (derivedFrom).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    /// The `name` member.
    pub name: String,

    /// The `type` member.
    pub r#type: TypeUse,

    /// The `required` member.
    pub required: bool,

    /// The `wire` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire: Option<QueryWire>,

    /// The `default` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<JsonValue>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// The `Params` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    /// The `path` member.
    pub path: Vec<Param>,

    /// The `query` member.
    pub query: Vec<Param>,

    /// The `header` member.
    pub header: Vec<Param>,
}

/// The `RefuseUnknownQuery` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefuseUnknownQuery {}

/// The `IgnoreUnknownQuery` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreUnknownQuery {
    /// The `reason` member.
    pub reason: Reason,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `IdentityAccess` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityAccess {
    /// The `identity` member.
    pub identity: IdentityId,

    /// The `schemes` member.
    pub schemes: Vec<SchemeId>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `OptionalAccess` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionalAccess {
    /// The `identity` member.
    pub identity: IdentityId,

    /// The `schemes` member.
    pub schemes: Vec<SchemeId>,

    /// The `reason` member.
    pub reason: Reason,

    /// The `onRefused` member.
    pub on_refused: RefusedCredential,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `PublicAccess` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAccess {
    /// The `reason` member.
    pub reason: Reason,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `PrincipalRequirement` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalRequirement {
    /// The `field` member.
    pub field: String,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `OperationScope` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationScope {
    /// The `scope` member.
    pub scope: ScopeId,

    /// Where the scope id is read; 'in: resolver' for an application resolver.
    pub source: ValueSource,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `RequirementSubject` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementSubject {
    /// The `source` member.
    pub source: ValueSource,

    /// The `defaulted` member.
    pub defaulted: bool,
}

/// The `RightRequirement` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RightRequirement {
    /// The `right` member.
    pub right: RightId,

    /// Values already validated against the right's params schema.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub params: Option<JsonValue>,

    /// The `subject` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<RequirementSubject>,

    /// The 'requirements' entry it was written through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// The `RuleRequirement` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleRequirement {
    /// The `rule` member.
    pub rule: RuleId,

    /// Values already validated against the rule's params schema.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub params: Option<JsonValue>,

    /// The `bucket` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bucket: Option<BucketId>,

    /// The 'requirements' entry it was written through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// The `Binding` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// The `from` member.
    pub from: ValueSource,

    /// The `to` member.
    pub to: ValueSource,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `InputField` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputField {
    /// The `name` member.
    pub name: String,

    /// The `wire` member.
    pub wire: FieldWire,
}

/// The request body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInput {
    /// The `media` member.
    pub media: InputMediaType,

    /// The `schema` member.
    pub schema: TypeUse,

    /// The `bodyLimitBytes` member.
    #[serde(deserialize_with = "integers::count")]
    pub body_limit_bytes: i64,

    /// The `rawBody` member.
    pub raw_body: bool,

    /// The `fields` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<InputField>>,

    /// The body fields of the rule proofs read in the body, each once, in requirement order; absent when there is none. Targets render the body as the input schema's properties followed by these fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proofs: Option<Vec<InputProof>>,

    /// The `origin` member.
    pub origin: Origin,
}

/// A body field the compiler adds to the input for a rule proof read in the body (derivation 'rule.proof'): required and sensitive (ADR 0002 section 9). A proof read in a header is a derived header parameter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputProof {
    /// The `name` member.
    pub name: String,

    /// The `schema` member.
    pub schema: TypeUse,

    /// The proof's wire form, as an input field's: present exactly when the input's media is form or multipart, and never of kind 'file' (invariant ir.input-proof.wire).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire: Option<FieldWire>,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `ResponseHeader` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseHeader {
    /// The `name` member.
    pub name: String,

    /// The `type` member.
    pub r#type: TypeUse,

    /// The `required` member.
    pub required: bool,

    /// The `semantic` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic: Option<ResponseHeaderSemantic>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// A success or derived non-error response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    /// The `status` member.
    #[serde(deserialize_with = "integers::http_status")]
    pub status: i64,

    /// Absent for an empty body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,

    /// The `body` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<TypeUse>,

    /// The `shape` member.
    pub shape: ResponseShape,

    /// The `headers` member.
    pub headers: Vec<ResponseHeader>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,

    /// The docs written on the response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,
}

/// A code the operation can answer, declared or derived.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationError {
    /// The `code` member.
    pub code: ErrorCode,

    /// The `example` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub example: Option<JsonValue>,

    /// Sorted by role; absent when the code answers no role here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<ErrorRoleBinding>>,

    /// The `retryHeader` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_header: Option<RetryHeader>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}

/// A role this code answers on the operation and the template filling its params from the role's data (ADR 0006 section 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorRoleBinding {
    /// The `role` member.
    pub role: ErrorRole,

    /// Present if and only if the code declares params (invariant ir.error.role-params).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Template>,
}

/// The retry header of a 429 from a bucket rule (grammar 13, rateLimit).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryHeader {
    /// The `name` member.
    pub name: String,

    /// The required member of the code's params holding the delay in integer milliseconds.
    pub param: String,

    /// The `unit` member.
    pub unit: RetryUnit,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `FieldRightSubject` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRightSubject {
    /// Where the subject is read; 'in: holderField' names the holder's property on output.
    pub source: ValueSource,
}

/// A field right, materialised so targets never walk schemas (FR-23).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRight {
    /// The `schema` member.
    pub schema: SchemaId,

    /// The `pointer` member.
    pub pointer: String,

    /// The `right` member.
    pub right: RightId,

    /// The `params` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub params: Option<JsonValue>,

    /// The `subject` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<FieldRightSubject>,

    /// The `direction` member.
    pub direction: Direction,

    /// The `inputPolicy` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_policy: Option<InputPolicy>,

    /// The `always` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always: Option<FieldRightAlways>,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `DerivedIdempotency` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedIdempotency {
    /// The `header` member.
    pub header: String,

    /// The `replayHeader` member.
    pub replay_header: String,

    /// The `lifetimeMs` member.
    #[serde(deserialize_with = "integers::count")]
    pub lifetime_ms: i64,

    /// The `required` member.
    pub required: bool,

    /// The `enforce` member.
    pub enforce: IdempotencyEnforcement,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `ExemptIdempotency` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExemptIdempotency {
    /// The `reason` member.
    pub reason: Reason,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `Concurrency` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Concurrency {
    /// The `version` member.
    pub version: ValueSource,

    /// The `field` member.
    pub field: String,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `Owner` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Owner {
    /// The `kind` member.
    pub kind: OwnerKind,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `CacheDirectives` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheDirectives {
    /// The `maxAgeMs` member.
    #[serde(deserialize_with = "integers::count")]
    pub max_age_ms: i64,

    /// The `sharedMaxAgeMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub shared_max_age_ms: Option<i64>,

    /// The `staleWhileRevalidateMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub stale_while_revalidate_ms: Option<i64>,

    /// The `staleIfErrorMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub stale_if_error_ms: Option<i64>,

    /// The `immutable` member.
    pub immutable: bool,

    /// The `noCache` member.
    pub no_cache: bool,

    /// The `mustRevalidate` member.
    pub must_revalidate: bool,
}

/// The `CallerCacheControl` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallerCacheControl {
    /// The `caller` member.
    pub caller: CallerKind,

    /// The `cacheControl` member.
    pub cache_control: String,
}

/// Cache settings (ADR 0004 section 7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    /// The `family` member.
    pub family: String,

    /// Absent if and only if the family is 'never' (invariant ir.cache.directives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directives: Option<CacheDirectives>,

    /// The `anonymous` member.
    pub anonymous: CacheVisibility,

    /// The `vary` member.
    pub vary: Vec<String>,

    /// The `etag` member.
    pub etag: bool,

    /// The `perCallerKind` member.
    pub per_caller_kind: Vec<CallerCacheControl>,

    /// Authoritative: when true the response is never stored, whatever 'directives' hold. True when the family is 'never' or a response carries a sensitive value: a sensitive property or scalar use in its body or a header's type (ADR 0003 section 6, invariant ir.cache.sensitive-no-store).
    pub no_store: bool,

    /// The `origin` member.
    pub origin: Origin,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// The `SortKey` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortKey {
    /// The `key` member.
    pub key: String,

    /// The `right` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<RightId>,

    /// The params of 'right', validated against the right's params schema; only with 'right' (ADR 0002 section 10).
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub params: Option<JsonValue>,

    /// Where the right's subject is read on the request; only with 'right' (ADR 0003 section 6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<FieldRightSubject>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}

/// The paging of a list; 'style' is absent for an unpaged list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paging {
    /// The `style` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<PagingId>,

    /// The `maxLimit` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_limit: Option<i64>,

    /// The `defaultLimit` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_limit: Option<i64>,

    /// The `overLimit` member.
    pub over_limit: OverLimitPolicy,

    /// The `token` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<PagingToken>,

    /// The `sortKeys` member.
    pub sort_keys: Vec<SortKey>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `DerivedCsrf` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedCsrf {
    /// The `header` member.
    pub header: String,

    /// The `derivedFrom` member.
    pub derived_from: DerivedFrom,
}

/// The `ExemptCsrf` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExemptCsrf {
    /// The `reason` member.
    pub reason: Reason,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `Degradable` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Degradable {
    /// The `paths` member.
    pub paths: Vec<String>,

    /// The header listing degraded parts, an RFC 9110 token; required when the operation's format has no 'degraded' meta member (invariant ir.degradable.header).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `Deprecation` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deprecation {
    /// The day the operation is deprecated, a calendar date, the Deprecation header's date (RFC 9745).
    pub since: String,

    /// The `sunset` member.
    pub sunset: String,

    /// The `successor` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successor: Option<OperationRef>,

    /// The Link rel of the successor, an RFC 8288 registered relation name; present if and only if 'successor' is (invariant ir.deprecation.headers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successor_rel: Option<String>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `OperationMaturity` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationMaturity {
    /// The `level` member.
    pub level: Maturity,

    /// The `source` member.
    pub source: MaturitySource,

    /// The `reason` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<Reason>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The collection or single it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResource {
    /// The `type` member.
    pub r#type: String,

    /// The `idParam` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_param: Option<String>,

    /// The `idProperty` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_property: Option<String>,
}

/// A route example; with 'error', 'value' holds the code's params.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationExample {
    /// The `status` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_http_status",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<i64>,

    /// The `request` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<bool>,

    /// The `error` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorCode>,

    /// The `value` member.
    pub value: JsonValue,
}

/// An HTTP operation (ADR 0004 section 7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    /// The `kind` member.
    pub kind: DeclarationKind,

    /// The `id` member.
    pub id: OperationId,

    /// The `name` member.
    pub name: Name,

    /// The `surface` member.
    pub surface: SurfaceId,

    /// The `op` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<OpShorthand>,

    /// The `resource` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<OperationResource>,

    /// The `features` member.
    pub features: Vec<Feature>,

    /// The `method` member.
    pub method: HttpMethod,

    /// The `path` member.
    pub path: String,

    /// The `safe` member.
    pub safe: bool,

    /// The `params` member.
    pub params: Params,

    /// The `unknownQuery` member.
    pub unknown_query: UnknownQuery,

    /// The `access` member.
    pub access: Access,

    /// The `callerKinds` member.
    pub caller_kinds: Vec<CallerKind>,

    /// The `principalRequires` member.
    pub principal_requires: Vec<PrincipalRequirement>,

    /// The `scopes` member.
    pub scopes: Vec<OperationScope>,

    /// The `requires` member.
    pub requires: Vec<Requirement>,

    /// The `bindings` member.
    pub bindings: Vec<Binding>,

    /// The `input` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<OperationInput>,

    /// The `responses` member.
    pub responses: Vec<Response>,

    /// The `errors` member.
    pub errors: Vec<OperationError>,

    /// The `fieldRights` member.
    pub field_rights: Vec<FieldRight>,

    /// The `idempotency` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency: Option<Idempotency>,

    /// The `concurrency` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<Concurrency>,

    /// The `owner` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<Owner>,

    /// The `cache` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<Cache>,

    /// The `paging` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paging: Option<Paging>,

    /// The `filteredBy` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filtered_by: Option<RightId>,

    /// The `degradable` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degradable: Option<Degradable>,

    /// The `budgetMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub budget_ms: Option<i64>,

    /// The `deadlineHeader` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline_header: Option<String>,

    /// The `deprecated` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<Deprecation>,

    /// The `relays` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relays: Option<OperationRef>,

    /// The `upstream` member.
    pub upstream: Vec<ServiceId>,

    /// The `maturity` member.
    pub maturity: OperationMaturity,

    /// The `internal` member.
    pub internal: bool,

    /// The `csrf` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csrf: Option<Csrf>,

    /// The `format` member.
    pub format: FormatId,

    /// The `tags` member.
    pub tags: Vec<String>,

    /// The `examples` member.
    pub examples: IrMap<String, OperationExample>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}
