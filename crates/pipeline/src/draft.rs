//! The draft IR the passes read and write (ADR 0006 section 2).
//!
//! The draft is the IR minus what finalize writes (`irVersion`, `irRevision`, `kinds`,
//! `features`, and each operation's `features`), with every catalogue and every list present
//! from the start and every other member optional until its owner writes it. Finalize checks
//! completeness by decoding the finished draft into the strict IR.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Access, Api, ApiCaller, ApiDocument, ApiKind, ApiRole, ApiVersion, ApiWire, Binding, Bucket,
    BucketId, Cache, CallerKind, Compat, Concurrency, Conventions, Csrf, DeclarationKind,
    Degradable, Deprecation, DerivedFrom, Docs, DocumentId, Enum, EnumId, ErrorCode, ErrorDecl,
    ExtensionKeyDecl, ExtensionKeyId, Extensions, FieldRight, FormatId, HeaderDecl, HeaderId,
    HttpMethod, Idempotency, Identity, IdentityId, InputField, InputMediaType, InputProof, IrMap,
    Lint, Maturity, Name, NatureDecl, NatureId, OpShorthand, OperationError, OperationExample,
    OperationId, OperationMaturity, OperationRef, OperationResource, OperationScope, Origin, Owner,
    PackRef, Paging, PagingId, PagingStyle, Params, PathVersion, PrincipalRequirement, Requirement,
    Response, Right, RightId, Rule, RuleId, Scalar, ScalarId, Schema, SchemaId, Scheme, SchemeId,
    Scope, ScopeId, Service, ServiceId, Surface, SurfaceId, TypeUse, UnknownQuery, ValueSource,
    WireFormat,
};
use seampact_json::{JsonValue, escape_pointer};
use serde::{Deserialize, Serialize};

use crate::count::optional_count;

/// The request body of an operation in the draft: the members of later halves are optional.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOperationInput {
    /// The `media` member.
    pub media: InputMediaType,

    /// The `schema` member; the `unknownKeys` of a reference is a default field.
    pub schema: TypeUse,

    /// The `bodyLimitBytes` member, written by `derive.wire`.
    #[serde(
        default,
        deserialize_with = "optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub body_limit_bytes: Option<i64>,

    /// The `rawBody` member, a default field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_body: Option<bool>,

    /// The `fields` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<InputField>>,

    /// The `proofs` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proofs: Option<Vec<InputProof>>,

    /// The `origin` member.
    pub origin: Origin,
}

/// The concurrency of an operation in the draft: `derivedFrom` is written by `derive.wire`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftConcurrency {
    /// The `version` member.
    pub version: ValueSource,

    /// The `field` member.
    pub field: String,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

impl From<Concurrency> for DraftConcurrency {
    fn from(concurrency: Concurrency) -> Self {
        Self {
            version: concurrency.version,
            field: concurrency.field,
            derived_from: Some(concurrency.derived_from),
        }
    }
}

/// An operation in the draft: every member optional until its owner writes it, `features` absent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOperation {
    /// The `kind` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<DeclarationKind>,
    /// The `id` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<OperationId>,
    /// The `name` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<Name>,
    /// The `surface` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<SurfaceId>,
    /// The `op` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<OpShorthand>,
    /// The `resource` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<OperationResource>,
    /// The `method` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<HttpMethod>,
    /// The `path` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `safe` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safe: Option<bool>,
    /// The `params` member: `tree.nodes` creates its three lists, later halves append to them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Params>,
    /// The `unknownQuery` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_query: Option<UnknownQuery>,
    /// The `access` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<Access>,
    /// The `callerKinds` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_kinds: Option<Vec<CallerKind>>,
    /// The `principalRequires` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub principal_requires: Option<Vec<PrincipalRequirement>>,
    /// The `scopes` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<OperationScope>>,
    /// The `requires` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Vec<Requirement>>,
    /// The `bindings` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Vec<Binding>>,
    /// The `input` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<DraftOperationInput>,
    /// The `responses` member: `tree.nodes` creates the list, `derive.wire` appends to it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub responses: Option<Vec<Response>>,
    /// The `errors` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<OperationError>>,
    /// The `fieldRights` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_rights: Option<Vec<FieldRight>>,
    /// The `idempotency` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency: Option<Idempotency>,
    /// The `concurrency` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<DraftConcurrency>,
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
        deserialize_with = "optional_count",
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<Vec<ServiceId>>,
    /// The `maturity` member, a default field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maturity: Option<OperationMaturity>,
    /// The `internal` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal: Option<bool>,
    /// The `csrf` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csrf: Option<Csrf>,
    /// The `format` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<FormatId>,
    /// The `tags` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// The `examples` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<IrMap<String, OperationExample>>,
    /// The `docs` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,
    /// The `extensions` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Extensions>,
    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}

impl DraftOperation {
    /// The id of the operation as text, or its position when `tree.nodes` wrote none.
    #[must_use]
    pub fn label(&self, position: usize) -> String {
        match &self.id {
            Some(id) => id.as_ref().to_owned(),
            None => format!("#{position}"),
        }
    }
}

/// The members of the api `tree.nodes` writes: every one but `wire`.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiDeclaration {
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
    pub role: Option<ApiRole>,
    /// The `maturity` member.
    pub maturity: Maturity,
    /// The `caller` member.
    pub caller: Option<ApiCaller>,
    /// The `compat` member.
    pub compat: Compat,
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

/// The api in the draft: `wire` is written by `derive.wire`, after `tree.nodes` writes the rest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftApi {
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
    /// The `wire` member, written by `derive.wire`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire: Option<ApiWire>,
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

impl From<ApiDeclaration> for DraftApi {
    fn from(declaration: ApiDeclaration) -> Self {
        Self {
            id: declaration.id,
            name: declaration.name,
            version: declaration.version,
            kind: declaration.kind,
            path_version: declaration.path_version,
            role: declaration.role,
            maturity: declaration.maturity,
            caller: declaration.caller,
            compat: declaration.compat,
            wire: None,
            surfaces: declaration.surfaces,
            documents: declaration.documents,
            docs: declaration.docs,
            extensions: declaration.extensions,
            origin: declaration.origin,
        }
    }
}

impl From<Api> for DraftApi {
    fn from(api: Api) -> Self {
        Self {
            id: api.id,
            name: api.name,
            version: api.version,
            kind: api.kind,
            path_version: api.path_version,
            role: api.role,
            maturity: api.maturity,
            caller: api.caller,
            compat: api.compat,
            wire: Some(api.wire),
            surfaces: api.surfaces,
            documents: api.documents,
            docs: api.docs,
            extensions: api.extensions,
            origin: api.origin,
        }
    }
}

/// The draft IR of one api (ADR 0006 section 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftIr {
    /// The `api` member, written by `tree.nodes` (its `wire` by `derive.wire`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<DraftApi>,
    /// The `packs` member.
    pub packs: Vec<PackRef>,
    /// The `conventions` catalogue.
    pub conventions: Conventions,
    /// The `formats` catalogue.
    pub formats: IrMap<FormatId, WireFormat>,
    /// The `pagings` catalogue.
    pub pagings: IrMap<PagingId, PagingStyle>,
    /// The `schemas` catalogue.
    pub schemas: IrMap<SchemaId, Schema>,
    /// The `scalars` catalogue.
    pub scalars: IrMap<ScalarId, Scalar>,
    /// The `enums` catalogue.
    pub enums: IrMap<EnumId, Enum>,
    /// The `errors` catalogue.
    pub errors: IrMap<ErrorCode, ErrorDecl>,
    /// The `natures` catalogue.
    pub natures: IrMap<NatureId, NatureDecl>,
    /// The `schemes` catalogue.
    pub schemes: IrMap<SchemeId, Scheme>,
    /// The `headers` catalogue.
    pub headers: IrMap<HeaderId, HeaderDecl>,
    /// The `identities` catalogue.
    pub identities: IrMap<IdentityId, Identity>,
    /// The `rights` catalogue.
    pub rights: IrMap<RightId, Right>,
    /// The `rules` catalogue.
    pub rules: IrMap<RuleId, Rule>,
    /// The `scopes` catalogue.
    pub scopes: IrMap<ScopeId, Scope>,
    /// The `buckets` catalogue.
    pub buckets: IrMap<BucketId, Bucket>,
    /// The `services` catalogue.
    pub services: IrMap<ServiceId, Service>,
    /// The `extensionKeys` catalogue.
    pub extension_keys: IrMap<ExtensionKeyId, ExtensionKeyDecl>,
    /// The `lint` member, written by `tree.nodes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lint: Option<Lint>,
    /// The operations, which only `tree.nodes` creates.
    pub operations: Vec<DraftOperation>,
}

impl DraftIr {
    /// A new draft: every catalogue empty, `packs` and `operations` empty, nothing else.
    #[must_use]
    pub fn new() -> Self {
        Self {
            api: None,
            packs: Vec::new(),
            conventions: IrMap::new(),
            formats: IrMap::new(),
            pagings: IrMap::new(),
            schemas: IrMap::new(),
            scalars: IrMap::new(),
            enums: IrMap::new(),
            errors: IrMap::new(),
            natures: IrMap::new(),
            schemes: IrMap::new(),
            headers: IrMap::new(),
            identities: IrMap::new(),
            rights: IrMap::new(),
            rules: IrMap::new(),
            scopes: IrMap::new(),
            buckets: IrMap::new(),
            services: IrMap::new(),
            extension_keys: IrMap::new(),
            lint: None,
            operations: Vec::new(),
        }
    }

    /// The draft as the JSON value the draft fixtures and the expected deltas are written in.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when a member does not encode as JSON.
    pub fn to_json_value(&self) -> Result<JsonValue, InternalError> {
        let value = serde_json::to_value(self).map_err(|failure| {
            InternalError::new(format!("the draft does not encode: {failure}"))
        })?;

        JsonValue::try_from(value).map_err(|failure| {
            InternalError::new(format!("the draft holds no JSON value: {failure}"))
        })
    }

    /// Reads a draft from its JSON value.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the value does not fit the draft form, or when encoding the
    /// decoded draft gives another value (an unknown or dropped member): the draft is built by
    /// the passes, so a misfit is a bug. The error names the first differing pointer.
    pub fn from_json_value(value: &JsonValue) -> Result<Self, InternalError> {
        let tree = serde_json::to_value(value).map_err(|failure| {
            InternalError::new(format!("the draft value does not encode: {failure}"))
        })?;

        let draft: Self = serde_json::from_value(tree).map_err(|failure| {
            InternalError::new(format!(
                "the draft value does not fit the draft form: {failure}"
            ))
        })?;

        let encoded = draft.to_json_value()?;

        match first_difference(value, &encoded, "") {
            Some(pointer) => Err(InternalError::new(format!(
                "the draft value does not survive the draft form: it differs at '{pointer}'"
            ))),
            None => Ok(draft),
        }
    }
}

/// The pointer of the first member where `left` and `right` differ, `None` when they are equal.
fn first_difference(left: &JsonValue, right: &JsonValue, pointer: &str) -> Option<String> {
    match (left, right) {
        (JsonValue::Object(left_members), JsonValue::Object(right_members)) => left_members
            .keys()
            .chain(right_members.keys())
            .find_map(|key| {
                let child = format!("{pointer}/{}", escape_pointer(key));

                match (left_members.get(key), right_members.get(key)) {
                    (Some(left_child), Some(right_child)) => {
                        first_difference(left_child, right_child, &child)
                    }
                    _ => Some(child),
                }
            }),
        (JsonValue::Array(left_items), JsonValue::Array(right_items)) => {
            let shared = left_items.len().min(right_items.len());
            let shared_difference = left_items.iter().zip(right_items).enumerate().find_map(
                |(index, (left_child, right_child))| {
                    first_difference(left_child, right_child, &format!("{pointer}/{index}"))
                },
            );

            shared_difference.or_else(|| {
                (left_items.len() != right_items.len()).then(|| format!("{pointer}/{shared}"))
            })
        }
        _ => (left != right).then(|| pointer.to_owned()),
    }
}

impl Default for DraftIr {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_and_sync<T: Send + Sync>() {}

    #[test]
    fn the_draft_is_send_and_sync() {
        assert_send_and_sync::<DraftIr>();
        assert_send_and_sync::<DraftOperation>();
    }

    #[test]
    fn a_new_draft_holds_empty_catalogues() {
        let draft = DraftIr::new();

        assert!(draft.api.is_none() && draft.lint.is_none());
        assert!(draft.operations.is_empty() && draft.packs.is_empty());
        assert!(
            draft.rights.is_empty() && draft.schemas.is_empty() && draft.conventions.is_empty()
        );
    }

    #[test]
    fn a_new_draft_is_its_own_json_form() {
        let draft = DraftIr::new();
        let value = draft.to_json_value().expect("a new draft encodes");

        assert_eq!(DraftIr::from_json_value(&value).expect("it decodes"), draft);
    }

    #[test]
    fn a_proto_id_survives_the_catalogue_round_trip() {
        let mut draft = DraftIr::new().to_json_value().expect("a new draft encodes");
        let right = serde_json::json!({"id": "__proto__", "subject": {"kind": "scope", "scope": "space"}, "errors": [], "docs": {}, "extensions": {}, "origin": {"layer": "api", "pointer": "/rights/__proto__"}});

        let JsonValue::Object(members) = &mut draft else {
            panic!("a draft is an object");
        };
        members.insert(
            "rights".to_owned(),
            JsonValue::try_from(serde_json::json!({"__proto__": right})).expect("a JSON value"),
        );

        let decoded = DraftIr::from_json_value(&draft).expect("it decodes");

        assert_eq!(decoded.rights.len(), 1);
        assert_eq!(decoded.to_json_value().expect("it encodes"), draft);
    }

    #[test]
    fn an_unknown_member_of_an_operation_is_an_internal_error_naming_its_pointer() {
        let mut draft = DraftIr::new().to_json_value().expect("a new draft encodes");
        let JsonValue::Object(members) = &mut draft else {
            panic!("a draft is an object");
        };
        members.insert(
            "operations".to_owned(),
            JsonValue::try_from(serde_json::json!([{"id": "listTasks", "unknownMember": 1}]))
                .expect("a JSON value"),
        );

        let failure = DraftIr::from_json_value(&draft).expect_err("the member is dropped");

        assert!(
            failure.to_string().contains("/operations/0/unknownMember"),
            "{failure}"
        );
    }
}
