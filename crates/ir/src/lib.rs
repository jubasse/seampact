//! The seampact IR and source-map types, held to the IR JSON Schemas.
//!
//! [`ContractIr`] and [`SourceMap`] are the two document roots: they read from JSON text and
//! write their canonical bytes. Each schema definition is a Rust type of the same name; open enums
//! and unions keep an unknown value or variant as read, and their registries ([`OPEN_ENUMS`],
//! [`UNIONS`]) list every definition. [`IR_SCHEMA_FILES`] embeds the schema files.

mod common;
mod contract;
mod declarations;
mod document;
mod error;
mod formats;
mod ids;
mod integers;
mod ir_map;
mod layer;
mod open_enums;
mod operation;
mod schema_files;
mod schemas;
mod source_map;
mod unions;
mod version;

pub use common::{DerivedFrom, Docs, Extensions, Name, Origin, SchemaRef, ValueSource};
pub use contract::{
    Api, ApiCaller, ApiDocument, ApiWire, Compat, ContractIr, ConventionValue, Conventions,
    ExtensionKeyDecl, LabelApiVersion, Lint, LintAllow, LintRule, PackRef, PathApiVersion,
    PathVersion, Surface,
};
pub use declarations::{
    ApplicationSignature, BasicScheme, BearerFacts, BearerScheme, Bucket, CatalogueEnumSource,
    CookieScheme, CredentialIdentity, CredentialSchemes, Enum, ErrorDecl, ErrorHttp, HeaderDecl,
    HeaderScheme, IdentityHeaderUse, IgnoreKeysPolicy, KeepKeysPolicy, NatureDecl, NoSubject,
    OAuth2, QueryScheme, ResourceSubject, Right, Rule, RuleProof, SchemaPrincipal, Scope,
    ScopeSubject, Service, SignatureScheme, SignedIdentity, SourceSchemeKey, TemplateSignature,
    ValueSchemeKey, VariantsPrincipal, VocabularyEnumSource,
};
pub use error::IrError;
pub use formats::{
    ArrayTemplate, EachTemplate, ErrorShape, HeaderTemplate, LiteralTemplate, MetaMember,
    NamedTemplate, ObjectTemplate, ObjectTemplateMember, PagingLink, PagingRequestRole,
    PagingResponse, PagingStyle, PlainMemberName, PlainTextPart, Shape, SlotMemberName,
    SlotTemplate, SlotTextPart, SuccessShapes, TextTemplate, WireFormat,
};
pub use ids::{
    BucketId, DecimalLiteral, DerivationId, DocumentId, EnumId, ErrorCode, ExtensionKey,
    ExtensionKeyId, ExtensionPrefix, Feature, FormatId, HeaderId, IdentityId, NatureId,
    OperationId, PackName, PagingId, Reason, RightId, RuleId, ScalarId, SchemaId, SchemeId,
    ScopeId, ServiceId, Slot, SurfaceId, VariantId,
};
pub use ir_map::IrMap;
pub use layer::Layer;
pub use open_enums::{
    Absent, ApiKind, ApiRole, CacheVisibility, CallerKind, CompatPolicy, DeclarationKind,
    Direction, ErrorRole, ExtensionPlace, FieldRightAlways, FieldWireKind, HandlerResultMember,
    HeaderSemantic, HeaderSide, HeaderUseFor, HttpMethod, IdempotencyEnforcement, InputMediaType,
    InputPolicy, Int64Wire, InternalPolicy, JsonMediaType, LintSeverity, Maturity, MaturitySource,
    MetaFill, NameRole, NatureBase, OPEN_ENUMS, OpShorthand, OpenEnumEntry, OutputEnumForm,
    OverLimitPolicy, OwnerKind, PagingParamPlacement, PagingParamStyle, PagingPosition, PagingRole,
    PagingToken, PathVersionMode, ProofPlacement, QueryStyle, QueryWireKind, RefusedCredential,
    ResponseHeaderSemantic, ResponseShape, RetryUnit, ScalarType, SignatureEncoding,
    UnknownKeysPolicy, UnknownValue, UrlForm, UrlRole, ValueSourceIn,
};
pub use operation::{
    Binding, Cache, CacheDirectives, CallerCacheControl, Concurrency, Degradable, Deprecation,
    DerivedCsrf, DerivedIdempotency, ErrorRoleBinding, ExemptCsrf, ExemptIdempotency, FieldRight,
    FieldRightSubject, FieldWire, IdentityAccess, IgnoreUnknownQuery, InputField, InputProof,
    Operation, OperationError, OperationExample, OperationInput, OperationMaturity, OperationRef,
    OperationResource, OperationScope, OptionalAccess, Owner, Paging, Param, Params,
    PrincipalRequirement, PublicAccess, QueryWire, RefuseUnknownQuery, RequirementSubject,
    Response, ResponseHeader, RetryHeader, RightRequirement, RuleRequirement, SortKey,
};
pub use schema_files::{IR_SCHEMA_FILES, IrSchemaFile};
pub use schemas::{
    ArrayTypeUse, BodyUnionTag, EnumNarrowing, EnumTypeUse, FieldRestriction, FileTypeUse,
    HeaderUnionTag, JsonContent, MapSchema, ObjectSchema, OpaqueTypeUse, Pattern, Property,
    RefTypeUse, Refinements, Scalar, ScalarTypeUse, UnionSchema, UnionVariant, UnknownKeys,
};
pub use source_map::{SourceLocation, SourceMap};
pub use unions::{
    Access, ApiVersion, Csrf, EnumSource, Idempotency, Identity, KeysPolicy, MemberName, Principal,
    Requirement, RightSubject, Schema, Scheme, SchemeKey, SignatureVerify, Template, TextPart,
    TypeUse, UNIONS, UnionEntry, UnionTag, UnknownQuery, UnknownVariant, union_tags,
};
pub use version::{IR_REVISION, IR_VERSION};
