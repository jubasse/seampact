//! The declarations of the IR catalogues: errors, natures, headers, schemes, identities, rights, rules, scopes, buckets, services and enums.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    BucketId, DerivedFrom, Direction, Docs, EnumId, EnumSource, ErrorCode, ErrorRole, Extensions,
    HeaderId, HeaderSemantic, HeaderSide, HeaderUseFor, IdentityId, IrMap, KeysPolicy, Maturity,
    Name, NatureBase, NatureId, Origin, Principal, ProofPlacement, Reason, RightId, RightSubject,
    RuleId, SchemaRef, SchemeId, SchemeKey, ScopeId, ServiceId, SignatureEncoding, SignatureVerify,
    TypeUse, ValueSource, VariantId, integers,
};

/// The HTTP attributes of an error code (ADR 0014).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorHttp {
    /// The `status` member.
    #[serde(deserialize_with = "integers::http_status")]
    pub status: i64,
}

/// An error code of the registry (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDecl {
    /// The `code` member.
    pub code: ErrorCode,

    /// The declared family, or the code up to its first dot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,

    /// The `nature` member.
    pub nature: NatureBase,

    /// The `natureName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nature_name: Option<NatureId>,

    /// The `http` member.
    pub http: ErrorHttp,

    /// The `params` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<SchemaRef>,

    /// The `example` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub example: Option<JsonValue>,

    /// The `title` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `origin` member.
    pub origin: Origin,

    /// The `default` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<ErrorRole>,

    /// Every response of this code carries Cache-Control: no-store, since its params reach a sensitive value (ADR 0003 section 6, conventions.cache.sensitiveElsewhere: noStore); absent means false (invariant ir.error.sensitive-no-store).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_store: Option<bool>,
}

/// A nature of the contract (ADR 0002 section 11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NatureDecl {
    /// The `id` member.
    pub id: NatureId,

    /// The `base` member.
    pub base: NatureBase,

    /// The `docs` member.
    pub docs: Docs,

    /// The `origin` member.
    pub origin: Origin,
}

/// An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and 'request' for versionToken (invariant ir.header.members).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderDecl {
    /// The `id` member.
    pub id: HeaderId,

    /// The `semantic` member.
    pub semantic: HeaderSemantic,

    /// The `name` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The `in` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#in: Option<HeaderSide>,

    /// The `response` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,

    /// The `request` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<String>,

    /// The `schema` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<TypeUse>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `ValueSchemeKey` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueSchemeKey {
    /// The key id the application looks its secret up by; never the secret.
    pub value: String,
}

/// The `SourceSchemeKey` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSchemeKey {
    /// Where the request carries the key id (path, query or header).
    pub from: ValueSource,
}

/// The OAuth 2 facts of a bearer scheme, for documents only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuth2 {
    /// `OpenAPI` OAuth flows, copied as written.
    pub flows: JsonValue,
}

/// Document-only facts of a bearer scheme.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BearerFacts {
    /// The `format` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,

    /// The `oauth2` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2: Option<OAuth2>,

    /// The `openIdConnectUrl` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_id_connect_url: Option<String>,
}

/// The `TemplateSignature` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSignature {
    /// The `format` member.
    pub format: String,

    /// The `algorithm` member.
    pub algorithm: String,

    /// The `payload` member.
    pub payload: String,

    /// The `encoding` member.
    pub encoding: SignatureEncoding,

    /// The `toleranceMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub tolerance_ms: Option<i64>,

    /// The `key` member.
    pub key: SchemeKey,
}

/// The `ApplicationSignature` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSignature {
    /// The `headers` member.
    pub headers: Vec<String>,

    /// The `key` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<SchemeKey>,
}

/// A credential in a cookie; 'csrf' names the scheme that carries the CSRF token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The cookie name.
    pub name: String,

    /// The `csrf` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csrf: Option<SchemeId>,

    /// The `origin` member.
    pub origin: Origin,
}

/// A credential in a request header.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The header name.
    pub name: String,

    /// The `origin` member.
    pub origin: Origin,
}

/// A credential in a query parameter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The query parameter name.
    pub name: String,

    /// The `origin` member.
    pub origin: Origin,
}

/// A bearer token in the Authorization header.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BearerScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The `bearer` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bearer: Option<BearerFacts>,

    /// The `origin` member.
    pub origin: Origin,
}

/// HTTP basic credentials in the Authorization header.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BasicScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The `origin` member.
    pub origin: Origin,
}

/// A signed request, verified as 'signature' says.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureScheme {
    /// The `id` member.
    pub id: SchemeId,

    /// The signature header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The `signature` member.
    pub signature: SignatureVerify,

    /// The `origin` member.
    pub origin: Origin,
}

/// The schemes of a credential identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSchemes {
    /// The `read` member.
    pub read: Vec<SchemeId>,

    /// Empty when the identity is refused on writes.
    pub write: Vec<SchemeId>,

    /// The `optionalRead` member.
    pub optional_read: Vec<SchemeId>,
}

/// The `SchemaPrincipal` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPrincipal {
    /// The `schema` member.
    pub schema: SchemaRef,
}

/// The `VariantsPrincipal` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantsPrincipal {
    /// The `variants` member.
    pub variants: IrMap<VariantId, SchemaRef>,
}

/// The `IgnoreKeysPolicy` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreKeysPolicy {
    /// The `reason` member.
    pub reason: Reason,
}

/// The `KeepKeysPolicy` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepKeysPolicy {
    /// The `reason` member.
    pub reason: Reason,
}

/// A use of the headers catalogue by an identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityHeaderUse {
    /// The `header` member.
    pub header: HeaderId,

    /// The `for` member.
    pub r#for: HeaderUseFor,

    /// The `required` member.
    pub required: bool,

    /// The `schema` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<TypeUse>,

    /// The `from` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<ValueSource>,

    /// The `stale` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale: Option<ErrorCode>,

    /// The `origin` member.
    pub origin: Origin,
}

/// An identity reached through credential schemes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialIdentity {
    /// The `id` member.
    pub id: IdentityId,

    /// The `schemes` member.
    pub schemes: CredentialSchemes,

    /// The `principal` member.
    pub principal: Principal,

    /// The `errors` member.
    pub errors: Vec<ErrorCode>,

    /// The `headers` member.
    pub headers: Vec<IdentityHeaderUse>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}

/// An identity reached through one signature scheme (ADR 0013).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedIdentity {
    /// The `id` member.
    pub id: IdentityId,

    /// The `signed` member.
    pub signed: SchemeId,

    /// The `principal` member.
    pub principal: Principal,

    /// The `unknownKeys` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_keys: Option<KeysPolicy>,

    /// The `errors` member.
    pub errors: Vec<ErrorCode>,

    /// The `headers` member.
    pub headers: Vec<IdentityHeaderUse>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `NoSubject` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoSubject {}

/// The `ScopeSubject` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeSubject {
    /// The `scope` member.
    pub scope: ScopeId,
}

/// The `ResourceSubject` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSubject {
    /// The `type` member.
    pub r#type: Name,

    /// The `idSchema` member.
    pub id_schema: TypeUse,
}

/// A right (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Right {
    /// The `id` member.
    pub id: RightId,

    /// The `params` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<SchemaRef>,

    /// The `subject` member.
    pub subject: RightSubject,

    /// The `guest` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guest: Option<Reason>,

    /// The `errors` member.
    pub errors: Vec<ErrorCode>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,

    /// The `codeName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_name: Option<Name>,
}

/// The `RuleProof` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleProof {
    /// The `in` member.
    pub r#in: ProofPlacement,

    /// The `name` member.
    pub name: String,

    /// The `schema` member.
    pub schema: TypeUse,
}

/// A rule (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// The `id` member.
    pub id: RuleId,

    /// The `params` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<SchemaRef>,

    /// The `takesBucket` member.
    pub takes_bucket: bool,

    /// The `proof` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proof: Option<RuleProof>,

    /// The `errors` member.
    pub errors: Vec<ErrorCode>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}

/// A scope (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    /// The `id` member.
    pub id: ScopeId,

    /// The `idSchema` member.
    pub id_schema: TypeUse,

    /// The `within` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within: Option<ScopeId>,

    /// The `errors` member.
    pub errors: Vec<ErrorCode>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}

/// A rate-limit bucket (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    /// The `id` member.
    pub id: BucketId,

    /// The `key` member.
    pub key: Vec<ValueSource>,

    /// The `limit` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub limit: Option<i64>,

    /// The `windowMs` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub window_ms: Option<i64>,

    /// The `origin` member.
    pub origin: Origin,
}

/// An upstream service (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    /// The `id` member.
    pub id: ServiceId,

    /// The `maturity` member.
    pub maturity: Maturity,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `VocabularyEnumSource` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEnumSource {
    /// The `vocabulary` member.
    pub vocabulary: String,
}

/// The `CatalogueEnumSource` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueEnumSource {
    /// The `enum` member.
    pub r#enum: EnumId,
}

/// An enum; values keep the written order (ADR 0004 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Enum {
    /// The `id` member.
    pub id: EnumId,

    /// The `name` member.
    pub name: Name,

    /// The `values` member.
    pub values: Vec<String>,

    /// Identifier override per value (ADR 0007).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_names: Option<IrMap<String, Name>>,

    /// The `source` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<EnumSource>,

    /// The `localReason` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_reason: Option<Reason>,

    /// The `fallback` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,

    /// The `directions` member.
    pub directions: Vec<Direction>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `origin` member.
    pub origin: Origin,
}
