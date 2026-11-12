//! The IR document root and its api-level definitions.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    ApiKind, ApiRole, ApiVersion, Bucket, BucketId, CompatPolicy, DeclarationKind, Docs,
    DocumentId, Enum, EnumId, ErrorCode, ErrorDecl, ExtensionKey, ExtensionKeyId, ExtensionPlace,
    ExtensionPrefix, Extensions, Feature, FormatId, HeaderDecl, HeaderId, Identity, IdentityId,
    Int64Wire, InternalPolicy, IrMap, LintSeverity, Maturity, Name, NatureDecl, NatureId,
    Operation, Origin, OutputEnumForm, PagingId, PagingStyle, PathVersionMode, Reason, Right,
    RightId, Rule, RuleId, Scalar, ScalarId, Schema, SchemaId, Scheme, SchemeId, Scope, ScopeId,
    Service, ServiceId, SurfaceId, TypeUse, UrlForm, WireFormat, integers,
};

/// One IR document per api (ADR 0004 sections 1 and 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractIr {
    /// 1 until 1.0 and through 1.x (ADR 0005 section 2).
    #[serde(deserialize_with = "integers::positive")]
    pub ir_version: i64,

    /// Rises by one with every IR change (ADR 0005 section 2).
    #[serde(deserialize_with = "integers::positive")]
    pub ir_revision: i64,

    /// The `kinds` member.
    pub kinds: Vec<DeclarationKind>,

    /// The `features` member.
    pub features: Vec<Feature>,

    /// The `api` member.
    pub api: Api,

    /// The `packs` member.
    pub packs: Vec<PackRef>,

    /// The `conventions` member.
    pub conventions: Conventions,

    /// The `formats` member.
    pub formats: IrMap<FormatId, WireFormat>,

    /// The `pagings` member.
    pub pagings: IrMap<PagingId, PagingStyle>,

    /// The `schemas` member.
    pub schemas: IrMap<SchemaId, Schema>,

    /// The `scalars` member.
    pub scalars: IrMap<ScalarId, Scalar>,

    /// The `enums` member.
    pub enums: IrMap<EnumId, Enum>,

    /// The `errors` member.
    pub errors: IrMap<ErrorCode, ErrorDecl>,

    /// The `natures` member.
    pub natures: IrMap<NatureId, NatureDecl>,

    /// The `schemes` member.
    pub schemes: IrMap<SchemeId, Scheme>,

    /// The `headers` member.
    pub headers: IrMap<HeaderId, HeaderDecl>,

    /// The `identities` member.
    pub identities: IrMap<IdentityId, Identity>,

    /// The `rights` member.
    pub rights: IrMap<RightId, Right>,

    /// The `rules` member.
    pub rules: IrMap<RuleId, Rule>,

    /// The `scopes` member.
    pub scopes: IrMap<ScopeId, Scope>,

    /// The `buckets` member.
    pub buckets: IrMap<BucketId, Bucket>,

    /// The `services` member.
    pub services: IrMap<ServiceId, Service>,

    /// The `extensionKeys` member.
    pub extension_keys: IrMap<ExtensionKeyId, ExtensionKeyDecl>,

    /// The `lint` member.
    pub lint: Lint,

    /// The `operations` member.
    pub operations: Vec<Operation>,
}

/// A pack applied, in application order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRef {
    /// The `name` member.
    pub name: String,

    /// The `version` member.
    pub version: String,
}

/// The `Surface` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Surface {
    /// The `name` member.
    pub name: Name,

    /// The `prefix` member.
    pub prefix: String,

    /// The `pathVersion` member.
    pub path_version: PathVersionMode,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `ApiDocument` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDocument {
    /// The `surfaces` member.
    pub surfaces: Vec<SurfaceId>,

    /// The `internal` member.
    pub internal: InternalPolicy,
}

/// The `PathVersion` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathVersion {
    /// The `value` member.
    pub value: PathVersionMode,

    /// The `origin` member.
    pub origin: Origin,
}

/// The `ApiCaller` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCaller {
    /// The `identity` member.
    pub identity: IdentityId,

    /// The `right` member.
    pub right: RightId,
}

/// The `PathApiVersion` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathApiVersion {
    /// The number paths carry ('/v1').
    #[serde(deserialize_with = "integers::count")]
    pub number: i64,
}

/// The `LabelApiVersion` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelApiVersion {
    /// The `label` member.
    pub label: String,
}

/// The `Compat` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Compat {
    /// The `policy` member.
    pub policy: CompatPolicy,
}

/// The api (ADR 0004 section 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Api {
    /// The `id` member.
    pub id: String,

    /// The `name` member.
    pub name: Name,

    /// The `version` member.
    pub version: ApiVersion,

    /// The `kind` member.
    pub kind: ApiKind,

    /// The `pathVersion` member.
    pub path_version: PathVersion,

    /// The `role` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ApiRole>,

    /// The `maturity` member.
    pub maturity: Maturity,

    /// The `caller` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller: Option<ApiCaller>,

    /// The `compat` member.
    pub compat: Compat,

    /// The `wire` member.
    pub wire: ApiWire,

    /// The `surfaces` member.
    pub surfaces: IrMap<SurfaceId, Surface>,

    /// The `documents` member.
    pub documents: IrMap<DocumentId, ApiDocument>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,
}

/// The api-wide conventions a target acts on (ADR 0004 section 13).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiWire {
    /// The `int64` member.
    pub int64: Int64Wire,

    /// The `outputEnums` member.
    pub output_enums: OutputEnumForm,

    /// The `urls` member.
    pub urls: UrlForm,
}

/// A resolved convention value with the origin of the node that set it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConventionValue {
    /// The `value` member.
    pub value: JsonValue,

    /// The `origin` member.
    pub origin: Origin,
}

/// Resolved conventions, keyed by the dotted path of the convention under 'conventions' (for example 'pathVersion', 'idempotency.header'). Informative only: provenance for explain and lint. A target never acts on a convention; every convention a target acts on is a typed member (ADR 0004 section 13).
pub type Conventions = IrMap<String, ConventionValue>;

/// A declared extension key (ADR 0002 section 12).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionKeyDecl {
    /// The `id` member.
    pub id: ExtensionKeyId,

    /// The `prefix` member.
    pub prefix: ExtensionPrefix,

    /// The `key` member.
    pub key: ExtensionKey,

    /// The `schema` member.
    pub schema: TypeUse,

    /// The `places` member.
    pub places: Vec<ExtensionPlace>,

    /// The `origin` member.
    pub origin: Origin,
}

/// A resolved lint severity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintRule {
    /// The `severity` member.
    pub severity: LintSeverity,

    /// The `origin` member.
    pub origin: Origin,
}

/// An allow of ADR 0002 section 12.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintAllow {
    /// The `rule` member.
    pub rule: String,

    /// The `at` member.
    pub at: Origin,

    /// The `reason` member.
    pub reason: Reason,

    /// The `subtree` member.
    pub subtree: bool,
}

/// The `Lint` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lint {
    /// The `rules` member.
    pub rules: IrMap<String, LintRule>,

    /// The `allows` member.
    pub allows: Vec<LintAllow>,
}
