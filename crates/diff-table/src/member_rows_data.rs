//! The row of every member of every IR definition.

use crate::diff_kind::DiffKind;
use crate::member_row::{MemberRow, fixed};

/// The members of one definition, in declaration order.
pub(crate) type DefinitionRows = &'static [(&'static str, MemberRow)];

/// `MEMBER_ROWS`: the row of every member of every IR definition.
pub(crate) static MEMBER_ROWS: &[(&str, DefinitionRows)] = &[
    (
        "Name",
        &[
            ("segments", MemberRow::Kind(DiffKind::Name)),
            ("role", MemberRow::Kind(DiffKind::Name)),
            ("status", MemberRow::Kind(DiffKind::Name)),
        ],
    ),
    (
        "Docs",
        &[
            ("summary", MemberRow::Kind(DiffKind::Annotation)),
            ("description", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Origin",
        &[
            ("api", MemberRow::Kind(DiffKind::Annotation)),
            ("layer", MemberRow::Kind(DiffKind::Annotation)),
            ("pointer", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "DerivedFrom",
        &[
            ("derivation", MemberRow::Kind(DiffKind::Annotation)),
            ("from", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ValueSource",
        &[
            ("in", fixed(DiffKind::Requirement, "changed")),
            ("name", fixed(DiffKind::Requirement, "changed")),
            ("prefixBits", fixed(DiffKind::Requirement, "changed")),
        ],
    ),
    ("ErrorHttp", &[("status", fixed(DiffKind::Error, "status"))]),
    (
        "ErrorDecl",
        &[
            ("code", MemberRow::Kind(DiffKind::Declaration)),
            ("family", fixed(DiffKind::Error, "family")),
            ("nature", fixed(DiffKind::Error, "nature")),
            ("natureName", fixed(DiffKind::Error, "nature")),
            ("http", fixed(DiffKind::Error, "status")),
            ("params", MemberRow::Kind(DiffKind::TypeChanged)),
            ("example", MemberRow::Kind(DiffKind::Annotation)),
            ("default", MemberRow::Kind(DiffKind::Annotation)),
            ("noStore", MemberRow::Kind(DiffKind::Annotation)),
            ("title", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "NatureDecl",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("base", fixed(DiffKind::Error, "nature")),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "HeaderDecl",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("semantic", fixed(DiffKind::Header, "semantic")),
            ("name", fixed(DiffKind::Header, "name")),
            ("in", fixed(DiffKind::Header, "name")),
            ("response", fixed(DiffKind::Header, "name")),
            ("request", fixed(DiffKind::Header, "name")),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ValueSchemeKey",
        &[
            ("kind", fixed(DiffKind::Scheme, "signature")),
            ("value", fixed(DiffKind::Scheme, "signature")),
        ],
    ),
    (
        "SourceSchemeKey",
        &[
            ("kind", fixed(DiffKind::Scheme, "signature")),
            ("from", fixed(DiffKind::Scheme, "signature")),
        ],
    ),
    (
        "OAuth2",
        &[("flows", MemberRow::Kind(DiffKind::Annotation))],
    ),
    (
        "BearerFacts",
        &[
            ("format", MemberRow::Kind(DiffKind::Annotation)),
            ("oauth2", MemberRow::Kind(DiffKind::Annotation)),
            ("openIdConnectUrl", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "TemplateSignature",
        &[
            ("verify", fixed(DiffKind::Scheme, "signature")),
            ("format", fixed(DiffKind::Scheme, "signature")),
            ("algorithm", fixed(DiffKind::Scheme, "signature")),
            ("payload", fixed(DiffKind::Scheme, "signature")),
            ("encoding", fixed(DiffKind::Scheme, "signature")),
            ("toleranceMs", fixed(DiffKind::Scheme, "signature")),
            ("key", fixed(DiffKind::Scheme, "signature")),
        ],
    ),
    (
        "ApplicationSignature",
        &[
            ("verify", fixed(DiffKind::Scheme, "signature")),
            ("headers", fixed(DiffKind::Scheme, "signature")),
            ("key", fixed(DiffKind::Scheme, "signature")),
        ],
    ),
    (
        "CookieScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("name", fixed(DiffKind::Scheme, "name")),
            ("csrf", fixed(DiffKind::Scheme, "csrf")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "HeaderScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("name", fixed(DiffKind::Scheme, "name")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "QueryScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("name", fixed(DiffKind::Scheme, "name")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "BearerScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("bearer", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "BasicScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "SignatureScheme",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Scheme, "kind")),
            ("name", fixed(DiffKind::Scheme, "name")),
            ("signature", fixed(DiffKind::Scheme, "signature")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "CredentialSchemes",
        &[
            ("read", MemberRow::Kind(DiffKind::Identity)),
            ("write", MemberRow::Kind(DiffKind::Identity)),
            ("optionalRead", MemberRow::Kind(DiffKind::Identity)),
        ],
    ),
    (
        "SchemaPrincipal",
        &[
            ("kind", MemberRow::Kind(DiffKind::Identity)),
            ("schema", MemberRow::Kind(DiffKind::Identity)),
        ],
    ),
    (
        "VariantsPrincipal",
        &[
            ("kind", MemberRow::Kind(DiffKind::Identity)),
            ("variants", MemberRow::Kind(DiffKind::Identity)),
        ],
    ),
    (
        "IgnoreKeysPolicy",
        &[
            ("policy", fixed(DiffKind::Identity, "unknownKeys")),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "KeepKeysPolicy",
        &[
            ("policy", fixed(DiffKind::Identity, "unknownKeys")),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "IdentityHeaderUse",
        &[
            ("header", MemberRow::Kind(DiffKind::Identity)),
            ("for", MemberRow::Kind(DiffKind::Identity)),
            ("required", MemberRow::Kind(DiffKind::Identity)),
            ("schema", MemberRow::Kind(DiffKind::Identity)),
            ("from", MemberRow::Kind(DiffKind::Identity)),
            ("stale", MemberRow::Kind(DiffKind::Identity)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "CredentialIdentity",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Identity, "kind")),
            ("schemes", MemberRow::Kind(DiffKind::Identity)),
            ("principal", MemberRow::Kind(DiffKind::Identity)),
            ("errors", MemberRow::Kind(DiffKind::Annotation)),
            ("headers", MemberRow::Kind(DiffKind::Identity)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "SignedIdentity",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("kind", fixed(DiffKind::Identity, "kind")),
            ("signed", fixed(DiffKind::Identity, "schemeRemoved")),
            ("principal", MemberRow::Kind(DiffKind::Identity)),
            ("unknownKeys", fixed(DiffKind::Identity, "unknownKeys")),
            ("errors", MemberRow::Kind(DiffKind::Annotation)),
            ("headers", MemberRow::Kind(DiffKind::Identity)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    ("NoSubject", &[("kind", fixed(DiffKind::Right, "subject"))]),
    (
        "ScopeSubject",
        &[
            ("kind", fixed(DiffKind::Right, "subject")),
            ("scope", fixed(DiffKind::Right, "subject")),
        ],
    ),
    (
        "ResourceSubject",
        &[
            ("kind", fixed(DiffKind::Right, "subject")),
            ("type", fixed(DiffKind::Right, "subject")),
            ("idSchema", fixed(DiffKind::Right, "subject")),
        ],
    ),
    (
        "Right",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("params", MemberRow::Kind(DiffKind::TypeChanged)),
            ("subject", fixed(DiffKind::Right, "subject")),
            ("guest", MemberRow::Kind(DiffKind::Right)),
            ("errors", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
            ("codeName", MemberRow::Kind(DiffKind::Name)),
        ],
    ),
    (
        "RuleProof",
        &[
            ("in", fixed(DiffKind::Rule, "proof")),
            ("name", fixed(DiffKind::Rule, "proof")),
            ("schema", fixed(DiffKind::Rule, "proof")),
        ],
    ),
    (
        "Rule",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("params", MemberRow::Kind(DiffKind::TypeChanged)),
            ("takesBucket", fixed(DiffKind::Rule, "takesBucket")),
            ("proof", fixed(DiffKind::Rule, "proof")),
            ("errors", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Scope",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("idSchema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("within", fixed(DiffKind::Scope, "within")),
            ("errors", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Bucket",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("key", fixed(DiffKind::Bucket, "key")),
            ("limit", MemberRow::Kind(DiffKind::Refinement)),
            ("windowMs", MemberRow::Kind(DiffKind::Refinement)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Service",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("maturity", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "VocabularyEnumSource",
        &[
            ("kind", MemberRow::Kind(DiffKind::Annotation)),
            ("vocabulary", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "CatalogueEnumSource",
        &[
            ("kind", MemberRow::Kind(DiffKind::Annotation)),
            ("enum", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Enum",
        &[
            ("id", MemberRow::Kind(DiffKind::TypeChanged)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("values", MemberRow::Kind(DiffKind::EnumValue)),
            ("codeNames", MemberRow::Kind(DiffKind::Name)),
            ("source", MemberRow::Kind(DiffKind::Annotation)),
            ("localReason", MemberRow::Kind(DiffKind::Annotation)),
            ("fallback", MemberRow::Kind(DiffKind::Unclassified)),
            ("directions", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ObjectSchema",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("properties", MemberRow::Kind(DiffKind::PropertyAdded)),
            ("id", MemberRow::Kind(DiffKind::TypeChanged)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("typeName", MemberRow::Kind(DiffKind::Name)),
            ("directions", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("deprecated", MemberRow::Kind(DiffKind::Deprecation)),
        ],
    ),
    (
        "MapSchema",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("keys", MemberRow::Kind(DiffKind::TypeChanged)),
            ("values", MemberRow::Kind(DiffKind::TypeChanged)),
            ("id", MemberRow::Kind(DiffKind::TypeChanged)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("typeName", MemberRow::Kind(DiffKind::Name)),
            ("directions", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("deprecated", MemberRow::Kind(DiffKind::Deprecation)),
        ],
    ),
    (
        "UnionSchema",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("tag", MemberRow::Kind(DiffKind::UnionTag)),
            ("variants", MemberRow::Kind(DiffKind::UnionVariant)),
            ("id", MemberRow::Kind(DiffKind::TypeChanged)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("typeName", MemberRow::Kind(DiffKind::Name)),
            ("directions", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("deprecated", MemberRow::Kind(DiffKind::Deprecation)),
        ],
    ),
    (
        "BodyUnionTag",
        &[
            ("in", MemberRow::Kind(DiffKind::UnionTag)),
            ("property", MemberRow::Kind(DiffKind::UnionTag)),
        ],
    ),
    (
        "HeaderUnionTag",
        &[
            ("in", MemberRow::Kind(DiffKind::UnionTag)),
            ("name", MemberRow::Kind(DiffKind::UnionTag)),
        ],
    ),
    (
        "UnionVariant",
        &[
            ("tag", MemberRow::Kind(DiffKind::UnionVariant)),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Property",
        &[
            ("name", MemberRow::Kind(DiffKind::PropertyAdded)),
            ("type", MemberRow::Kind(DiffKind::TypeChanged)),
            ("optional", MemberRow::Kind(DiffKind::PropertyRequired)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("sensitive", MemberRow::Kind(DiffKind::Annotation)),
            ("restrictedTo", MemberRow::Kind(DiffKind::FieldRight)),
            ("default", MemberRow::Kind(DiffKind::DefaultChanged)),
            ("deprecated", MemberRow::Kind(DiffKind::Deprecation)),
            ("codeName", MemberRow::Kind(DiffKind::Name)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "FieldRestriction",
        &[
            ("right", fixed(DiffKind::FieldRight, "changed")),
            ("params", fixed(DiffKind::FieldRight, "changed")),
            ("inputPolicy", fixed(DiffKind::FieldRight, "changed")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "UnknownKeys",
        &[
            ("policy", MemberRow::Kind(DiffKind::UnknownKeys)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "RefTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("unknownKeys", MemberRow::Kind(DiffKind::UnknownKeys)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OpaqueTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "FileTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("media", MemberRow::Kind(DiffKind::Refinement)),
            ("maxSizeBytes", MemberRow::Kind(DiffKind::Refinement)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "EnumNarrowing",
        &[
            ("values", MemberRow::Kind(DiffKind::EnumValue)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "EnumTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("enum", MemberRow::Kind(DiffKind::TypeChanged)),
            ("narrowedTo", MemberRow::Kind(DiffKind::EnumValue)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "JsonContent",
        &[
            ("media", MemberRow::Kind(DiffKind::TypeChanged)),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
        ],
    ),
    (
        "ScalarTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("type", MemberRow::Kind(DiffKind::TypeChanged)),
            ("format", MemberRow::Kind(DiffKind::TypeChanged)),
            ("scalar", MemberRow::Kind(DiffKind::Name)),
            ("refinements", MemberRow::Kind(DiffKind::Refinement)),
            ("content", MemberRow::Kind(DiffKind::TypeChanged)),
            ("sensitive", MemberRow::Kind(DiffKind::Annotation)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ArrayTypeUse",
        &[
            ("kind", MemberRow::Kind(DiffKind::TypeChanged)),
            ("items", MemberRow::Kind(DiffKind::TypeChanged)),
            ("minItems", MemberRow::Kind(DiffKind::Refinement)),
            ("maxItems", MemberRow::Kind(DiffKind::Refinement)),
            ("nullable", MemberRow::Kind(DiffKind::Nullable)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Pattern",
        &[
            ("source", MemberRow::Kind(DiffKind::Annotation)),
            ("normalized", MemberRow::Kind(DiffKind::PatternChanged)),
        ],
    ),
    (
        "Refinements",
        &[
            ("minLength", MemberRow::Kind(DiffKind::Refinement)),
            ("maxLength", MemberRow::Kind(DiffKind::Refinement)),
            ("pattern", MemberRow::Kind(DiffKind::PatternChanged)),
            ("minimum", MemberRow::Kind(DiffKind::Refinement)),
            ("maximum", MemberRow::Kind(DiffKind::Refinement)),
            ("exclusiveMinimum", MemberRow::Kind(DiffKind::Refinement)),
            ("exclusiveMaximum", MemberRow::Kind(DiffKind::Refinement)),
            ("multipleOf", MemberRow::Kind(DiffKind::Refinement)),
        ],
    ),
    (
        "Scalar",
        &[
            ("id", MemberRow::Kind(DiffKind::Name)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("type", MemberRow::Kind(DiffKind::TypeChanged)),
            ("directions", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationRef",
        &[
            ("kind", MemberRow::Kind(DiffKind::Deprecation)),
            ("api", MemberRow::Kind(DiffKind::Deprecation)),
            ("id", MemberRow::Kind(DiffKind::Deprecation)),
        ],
    ),
    (
        "QueryWire",
        &[
            ("kind", fixed(DiffKind::TypeChanged, "wire")),
            ("style", fixed(DiffKind::TypeChanged, "wire")),
            ("explode", fixed(DiffKind::TypeChanged, "wire")),
            ("brackets", fixed(DiffKind::TypeChanged, "wire")),
        ],
    ),
    (
        "FieldWire",
        &[
            ("kind", fixed(DiffKind::TypeChanged, "wire")),
            ("style", fixed(DiffKind::TypeChanged, "wire")),
            ("explode", fixed(DiffKind::TypeChanged, "wire")),
            ("brackets", fixed(DiffKind::TypeChanged, "wire")),
        ],
    ),
    (
        "Param",
        &[
            ("name", MemberRow::Kind(DiffKind::ParamAdded)),
            ("type", MemberRow::Kind(DiffKind::TypeChanged)),
            ("required", MemberRow::Kind(DiffKind::ParamRequired)),
            ("wire", fixed(DiffKind::TypeChanged, "wire")),
            ("default", MemberRow::Kind(DiffKind::DefaultChanged)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Params",
        &[
            ("path", MemberRow::Kind(DiffKind::ParamAdded)),
            ("query", MemberRow::Kind(DiffKind::ParamAdded)),
            ("header", MemberRow::Kind(DiffKind::ParamAdded)),
        ],
    ),
    (
        "RefuseUnknownQuery",
        &[("policy", MemberRow::Kind(DiffKind::UnknownQuery))],
    ),
    (
        "IgnoreUnknownQuery",
        &[
            ("policy", MemberRow::Kind(DiffKind::UnknownQuery)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "IdentityAccess",
        &[
            ("kind", MemberRow::Kind(DiffKind::Access)),
            ("identity", MemberRow::Kind(DiffKind::Access)),
            ("schemes", MemberRow::Kind(DiffKind::Access)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OptionalAccess",
        &[
            ("kind", MemberRow::Kind(DiffKind::Access)),
            ("identity", MemberRow::Kind(DiffKind::Access)),
            ("schemes", MemberRow::Kind(DiffKind::Access)),
            ("onRefused", MemberRow::Kind(DiffKind::Access)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "PublicAccess",
        &[
            ("kind", MemberRow::Kind(DiffKind::Access)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "PrincipalRequirement",
        &[
            ("field", MemberRow::Kind(DiffKind::PrincipalRequirement)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationScope",
        &[
            ("scope", MemberRow::Kind(DiffKind::Scope)),
            ("source", fixed(DiffKind::Scope, "changed")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "RequirementSubject",
        &[
            ("source", fixed(DiffKind::Requirement, "changed")),
            ("defaulted", fixed(DiffKind::Requirement, "changed")),
        ],
    ),
    (
        "RightRequirement",
        &[
            ("kind", MemberRow::Kind(DiffKind::Requirement)),
            ("right", MemberRow::Kind(DiffKind::Requirement)),
            ("params", fixed(DiffKind::Requirement, "changed")),
            ("subject", fixed(DiffKind::Requirement, "changed")),
            ("entry", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "RuleRequirement",
        &[
            ("kind", MemberRow::Kind(DiffKind::Requirement)),
            ("rule", MemberRow::Kind(DiffKind::Requirement)),
            ("params", fixed(DiffKind::Requirement, "changed")),
            ("bucket", fixed(DiffKind::Requirement, "changed")),
            ("entry", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Binding",
        &[
            ("from", MemberRow::Kind(DiffKind::Binding)),
            ("to", MemberRow::Kind(DiffKind::Binding)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "InputField",
        &[
            ("name", MemberRow::Kind(DiffKind::Annotation)),
            ("wire", fixed(DiffKind::TypeChanged, "wire")),
        ],
    ),
    (
        "OperationInput",
        &[
            ("media", MemberRow::Kind(DiffKind::Body)),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("bodyLimitBytes", MemberRow::Kind(DiffKind::Refinement)),
            ("rawBody", fixed(DiffKind::Body, "rawBody")),
            ("fields", MemberRow::Kind(DiffKind::TypeChanged)),
            ("proofs", MemberRow::Kind(DiffKind::Proof)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "InputProof",
        &[
            ("name", MemberRow::Kind(DiffKind::Proof)),
            ("schema", MemberRow::Kind(DiffKind::TypeChanged)),
            ("wire", fixed(DiffKind::TypeChanged, "wire")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ResponseHeader",
        &[
            ("name", MemberRow::Kind(DiffKind::ResponseHeaderAdded)),
            ("type", MemberRow::Kind(DiffKind::TypeChanged)),
            (
                "required",
                MemberRow::Kind(DiffKind::ResponseHeaderRequired),
            ),
            (
                "semantic",
                fixed(DiffKind::ResponseHeaderSemantic, "changed"),
            ),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Response",
        &[
            ("status", MemberRow::Kind(DiffKind::Response)),
            ("media", MemberRow::Kind(DiffKind::Response)),
            ("body", MemberRow::Kind(DiffKind::TypeChanged)),
            ("shape", fixed(DiffKind::Response, "shape")),
            ("headers", MemberRow::Kind(DiffKind::ResponseHeaderAdded)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationError",
        &[
            ("code", MemberRow::Kind(DiffKind::Error)),
            ("example", MemberRow::Kind(DiffKind::Annotation)),
            ("roles", fixed(DiffKind::Error, "roles")),
            ("retryHeader", MemberRow::Kind(DiffKind::Error)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ErrorRoleBinding",
        &[
            ("role", fixed(DiffKind::Error, "roles")),
            ("params", fixed(DiffKind::Error, "roles")),
        ],
    ),
    (
        "RetryHeader",
        &[
            ("name", fixed(DiffKind::Error, "retryHeaderChanged")),
            ("param", fixed(DiffKind::Error, "retryHeaderChanged")),
            ("unit", fixed(DiffKind::Error, "retryHeaderChanged")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "FieldRightSubject",
        &[("source", fixed(DiffKind::FieldRight, "changed"))],
    ),
    (
        "FieldRight",
        &[
            ("schema", MemberRow::Kind(DiffKind::FieldRight)),
            ("pointer", MemberRow::Kind(DiffKind::FieldRight)),
            ("right", MemberRow::Kind(DiffKind::FieldRight)),
            ("direction", MemberRow::Kind(DiffKind::FieldRight)),
            ("params", fixed(DiffKind::FieldRight, "changed")),
            ("subject", fixed(DiffKind::FieldRight, "changed")),
            ("inputPolicy", fixed(DiffKind::FieldRight, "changed")),
            ("always", fixed(DiffKind::FieldRight, "changed")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "DerivedIdempotency",
        &[
            ("kind", MemberRow::Kind(DiffKind::Idempotency)),
            ("header", fixed(DiffKind::Idempotency, "header")),
            ("replayHeader", fixed(DiffKind::Idempotency, "replayHeader")),
            ("lifetimeMs", MemberRow::Kind(DiffKind::Idempotency)),
            ("required", MemberRow::Kind(DiffKind::Idempotency)),
            ("enforce", MemberRow::Kind(DiffKind::Idempotency)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ExemptIdempotency",
        &[
            ("kind", MemberRow::Kind(DiffKind::Idempotency)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Concurrency",
        &[
            ("version", fixed(DiffKind::Concurrency, "changed")),
            ("field", fixed(DiffKind::Concurrency, "changed")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Owner",
        &[
            ("kind", fixed(DiffKind::Owner, "changed")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "CacheDirectives",
        &[
            ("maxAgeMs", MemberRow::Kind(DiffKind::Annotation)),
            ("sharedMaxAgeMs", MemberRow::Kind(DiffKind::Annotation)),
            (
                "staleWhileRevalidateMs",
                MemberRow::Kind(DiffKind::Annotation),
            ),
            ("staleIfErrorMs", MemberRow::Kind(DiffKind::Annotation)),
            ("immutable", MemberRow::Kind(DiffKind::Annotation)),
            ("noCache", MemberRow::Kind(DiffKind::Annotation)),
            ("mustRevalidate", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "CallerCacheControl",
        &[
            ("caller", MemberRow::Kind(DiffKind::Annotation)),
            ("cacheControl", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Cache",
        &[
            ("family", MemberRow::Kind(DiffKind::Annotation)),
            ("directives", MemberRow::Kind(DiffKind::Annotation)),
            ("anonymous", MemberRow::Kind(DiffKind::Annotation)),
            ("vary", MemberRow::Kind(DiffKind::Annotation)),
            ("etag", MemberRow::Kind(DiffKind::Annotation)),
            ("perCallerKind", MemberRow::Kind(DiffKind::Annotation)),
            ("noStore", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "SortKey",
        &[
            ("key", MemberRow::Kind(DiffKind::Paging)),
            ("right", fixed(DiffKind::Paging, "sortKeyChanged")),
            ("params", fixed(DiffKind::Paging, "sortKeyChanged")),
            ("subject", fixed(DiffKind::Paging, "sortKeyChanged")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Paging",
        &[
            ("style", fixed(DiffKind::Paging, "style")),
            ("maxLimit", MemberRow::Kind(DiffKind::Refinement)),
            ("defaultLimit", fixed(DiffKind::Paging, "defaultLimit")),
            ("overLimit", MemberRow::Kind(DiffKind::Paging)),
            ("token", fixed(DiffKind::Paging, "token")),
            ("sortKeys", MemberRow::Kind(DiffKind::Paging)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "DerivedCsrf",
        &[
            ("kind", MemberRow::Kind(DiffKind::Csrf)),
            ("header", fixed(DiffKind::Csrf, "changed")),
            ("derivedFrom", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ExemptCsrf",
        &[
            ("kind", MemberRow::Kind(DiffKind::Csrf)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Degradable",
        &[
            ("paths", MemberRow::Kind(DiffKind::Annotation)),
            ("header", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Deprecation",
        &[
            ("since", MemberRow::Kind(DiffKind::Deprecation)),
            ("sunset", MemberRow::Kind(DiffKind::Deprecation)),
            ("successor", MemberRow::Kind(DiffKind::Deprecation)),
            ("successorRel", MemberRow::Kind(DiffKind::Deprecation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationMaturity",
        &[
            ("level", MemberRow::Kind(DiffKind::Maturity)),
            ("source", MemberRow::Kind(DiffKind::Annotation)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationResource",
        &[
            ("type", MemberRow::Kind(DiffKind::Annotation)),
            ("idParam", MemberRow::Kind(DiffKind::Annotation)),
            ("idProperty", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "OperationExample",
        &[
            ("status", MemberRow::Kind(DiffKind::Annotation)),
            ("request", MemberRow::Kind(DiffKind::Annotation)),
            ("error", MemberRow::Kind(DiffKind::Annotation)),
            ("value", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Operation",
        &[
            ("kind", MemberRow::Kind(DiffKind::Unclassified)),
            ("id", MemberRow::Kind(DiffKind::OperationAdded)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("surface", MemberRow::Kind(DiffKind::OperationRoute)),
            ("op", MemberRow::Kind(DiffKind::Annotation)),
            ("resource", MemberRow::Kind(DiffKind::Annotation)),
            ("features", MemberRow::Kind(DiffKind::Annotation)),
            ("method", MemberRow::Kind(DiffKind::OperationRoute)),
            ("path", MemberRow::Kind(DiffKind::OperationRoute)),
            ("safe", fixed(DiffKind::OperationRoute, "safe")),
            ("params", MemberRow::Kind(DiffKind::ParamAdded)),
            ("unknownQuery", MemberRow::Kind(DiffKind::UnknownQuery)),
            ("access", MemberRow::Kind(DiffKind::Access)),
            ("callerKinds", MemberRow::Kind(DiffKind::CallerKind)),
            (
                "principalRequires",
                MemberRow::Kind(DiffKind::PrincipalRequirement),
            ),
            ("scopes", MemberRow::Kind(DiffKind::Scope)),
            ("requires", MemberRow::Kind(DiffKind::Requirement)),
            ("bindings", MemberRow::Kind(DiffKind::Binding)),
            ("input", MemberRow::Kind(DiffKind::Body)),
            ("responses", MemberRow::Kind(DiffKind::Response)),
            ("errors", MemberRow::Kind(DiffKind::Error)),
            ("fieldRights", MemberRow::Kind(DiffKind::FieldRight)),
            ("idempotency", MemberRow::Kind(DiffKind::Idempotency)),
            ("concurrency", MemberRow::Kind(DiffKind::Concurrency)),
            ("owner", MemberRow::Kind(DiffKind::Owner)),
            ("cache", MemberRow::Kind(DiffKind::Annotation)),
            ("paging", MemberRow::Kind(DiffKind::Paging)),
            ("filteredBy", MemberRow::Kind(DiffKind::FilteredBy)),
            ("degradable", MemberRow::Kind(DiffKind::Annotation)),
            ("budgetMs", MemberRow::Kind(DiffKind::Annotation)),
            ("deadlineHeader", MemberRow::Kind(DiffKind::Annotation)),
            ("deprecated", MemberRow::Kind(DiffKind::Deprecation)),
            ("relays", MemberRow::Kind(DiffKind::Unclassified)),
            ("upstream", MemberRow::Kind(DiffKind::Annotation)),
            ("maturity", MemberRow::Kind(DiffKind::Maturity)),
            ("internal", MemberRow::Kind(DiffKind::Annotation)),
            ("csrf", MemberRow::Kind(DiffKind::Csrf)),
            ("format", MemberRow::Kind(DiffKind::OperationFormat)),
            ("tags", MemberRow::Kind(DiffKind::Annotation)),
            ("examples", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "HeaderTemplate",
        &[
            ("name", MemberRow::Kind(DiffKind::Format)),
            ("value", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "Shape",
        &[
            ("body", MemberRow::Kind(DiffKind::Format)),
            ("headers", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "SuccessShapes",
        &[
            ("item", MemberRow::Kind(DiffKind::Format)),
            ("table", MemberRow::Kind(DiffKind::Format)),
            ("list", MemberRow::Kind(DiffKind::Format)),
            ("page", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "MetaMember",
        &[
            ("type", MemberRow::Kind(DiffKind::Format)),
            ("fill", MemberRow::Kind(DiffKind::Format)),
            ("source", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "ErrorShape",
        &[
            ("media", MemberRow::Kind(DiffKind::Format)),
            ("body", MemberRow::Kind(DiffKind::Format)),
            ("headers", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "WireFormat",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("media", fixed(DiffKind::Format, "media")),
            ("absent", fixed(DiffKind::Format, "absent")),
            ("success", fixed(DiffKind::Format, "success")),
            ("meta", fixed(DiffKind::Format, "meta")),
            ("error", fixed(DiffKind::Format, "error")),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "PagingRequestRole",
        &[
            ("role", MemberRow::Kind(DiffKind::PagingStyle)),
            ("in", MemberRow::Kind(DiffKind::PagingStyle)),
            ("name", MemberRow::Kind(DiffKind::PagingStyle)),
            ("base", MemberRow::Kind(DiffKind::PagingStyle)),
            ("style", MemberRow::Kind(DiffKind::PagingStyle)),
            ("direction", MemberRow::Kind(DiffKind::PagingStyle)),
        ],
    ),
    (
        "NamedTemplate",
        &[
            ("name", MemberRow::Kind(DiffKind::Format)),
            ("value", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "PagingLink",
        &[
            ("rel", MemberRow::Kind(DiffKind::PagingStyle)),
            ("role", MemberRow::Kind(DiffKind::PagingStyle)),
        ],
    ),
    (
        "PagingResponse",
        &[
            ("body", MemberRow::Kind(DiffKind::PagingStyle)),
            ("meta", MemberRow::Kind(DiffKind::PagingStyle)),
            ("headers", MemberRow::Kind(DiffKind::PagingStyle)),
            ("links", MemberRow::Kind(DiffKind::PagingStyle)),
        ],
    ),
    (
        "PagingStyle",
        &[
            ("id", MemberRow::Kind(DiffKind::Declaration)),
            ("position", fixed(DiffKind::PagingStyle, "position")),
            ("absent", fixed(DiffKind::PagingStyle, "absent")),
            ("request", fixed(DiffKind::PagingStyle, "request")),
            ("response", fixed(DiffKind::PagingStyle, "response")),
            (
                "handlerResult",
                fixed(DiffKind::PagingStyle, "handlerResult"),
            ),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "SlotTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("slot", MemberRow::Kind(DiffKind::Format)),
            ("path", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "PlainTextPart",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("text", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "SlotTextPart",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("slot", MemberRow::Kind(DiffKind::Format)),
            ("path", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "TextTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("parts", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "LiteralTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("value", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "PlainMemberName",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("text", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "SlotMemberName",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("slot", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "ObjectTemplateMember",
        &[
            ("name", MemberRow::Kind(DiffKind::Format)),
            ("value", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "ObjectTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("members", MemberRow::Kind(DiffKind::Format)),
            ("merge", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "ArrayTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("items", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "EachTemplate",
        &[
            ("kind", MemberRow::Kind(DiffKind::Format)),
            ("of", MemberRow::Kind(DiffKind::Format)),
            ("as", MemberRow::Kind(DiffKind::Format)),
        ],
    ),
    (
        "ContractIR",
        &[
            ("irVersion", MemberRow::Kind(DiffKind::Unclassified)),
            ("irRevision", MemberRow::Kind(DiffKind::Unclassified)),
            ("kinds", MemberRow::Kind(DiffKind::Unclassified)),
            ("features", MemberRow::Kind(DiffKind::Annotation)),
            ("api", MemberRow::Kind(DiffKind::Unclassified)),
            ("packs", MemberRow::Kind(DiffKind::PackUpgraded)),
            ("conventions", MemberRow::Kind(DiffKind::Annotation)),
            ("formats", MemberRow::Kind(DiffKind::Declaration)),
            ("pagings", MemberRow::Kind(DiffKind::Declaration)),
            ("schemas", MemberRow::Kind(DiffKind::TypeChanged)),
            ("scalars", MemberRow::Kind(DiffKind::TypeChanged)),
            ("enums", MemberRow::Kind(DiffKind::EnumValue)),
            ("errors", MemberRow::Kind(DiffKind::Declaration)),
            ("natures", MemberRow::Kind(DiffKind::Declaration)),
            ("schemes", MemberRow::Kind(DiffKind::Declaration)),
            ("headers", MemberRow::Kind(DiffKind::Declaration)),
            ("identities", MemberRow::Kind(DiffKind::Declaration)),
            ("rights", MemberRow::Kind(DiffKind::Declaration)),
            ("rules", MemberRow::Kind(DiffKind::Declaration)),
            ("scopes", MemberRow::Kind(DiffKind::Declaration)),
            ("buckets", MemberRow::Kind(DiffKind::Declaration)),
            ("services", MemberRow::Kind(DiffKind::Declaration)),
            ("extensionKeys", MemberRow::Kind(DiffKind::Annotation)),
            ("lint", MemberRow::Kind(DiffKind::Annotation)),
            ("operations", MemberRow::Kind(DiffKind::OperationAdded)),
        ],
    ),
    (
        "PackRef",
        &[
            ("name", MemberRow::Kind(DiffKind::PackUpgraded)),
            ("version", MemberRow::Kind(DiffKind::PackUpgraded)),
        ],
    ),
    (
        "Surface",
        &[
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("prefix", MemberRow::Kind(DiffKind::OperationRoute)),
            ("pathVersion", MemberRow::Kind(DiffKind::OperationRoute)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ApiDocument",
        &[
            ("surfaces", MemberRow::Kind(DiffKind::Annotation)),
            ("internal", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "PathVersion",
        &[
            ("value", MemberRow::Kind(DiffKind::OperationRoute)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ApiCaller",
        &[
            ("identity", MemberRow::Kind(DiffKind::Unclassified)),
            ("right", MemberRow::Kind(DiffKind::Unclassified)),
        ],
    ),
    (
        "PathApiVersion",
        &[
            ("kind", MemberRow::Kind(DiffKind::Unclassified)),
            ("number", MemberRow::Kind(DiffKind::Unclassified)),
        ],
    ),
    (
        "LabelApiVersion",
        &[
            ("kind", MemberRow::Kind(DiffKind::Unclassified)),
            ("label", MemberRow::Kind(DiffKind::Unclassified)),
        ],
    ),
    (
        "Compat",
        &[("policy", MemberRow::Kind(DiffKind::CompatPolicy))],
    ),
    (
        "Api",
        &[
            ("id", MemberRow::Kind(DiffKind::Unclassified)),
            ("name", MemberRow::Kind(DiffKind::Name)),
            ("version", MemberRow::Kind(DiffKind::Unclassified)),
            ("kind", MemberRow::Kind(DiffKind::Unclassified)),
            ("pathVersion", MemberRow::Kind(DiffKind::OperationRoute)),
            ("role", MemberRow::Kind(DiffKind::Unclassified)),
            ("maturity", MemberRow::Kind(DiffKind::Maturity)),
            ("caller", MemberRow::Kind(DiffKind::Unclassified)),
            ("compat", MemberRow::Kind(DiffKind::CompatPolicy)),
            ("wire", MemberRow::Kind(DiffKind::TypeChanged)),
            ("surfaces", MemberRow::Kind(DiffKind::OperationRoute)),
            ("documents", MemberRow::Kind(DiffKind::Annotation)),
            ("docs", MemberRow::Kind(DiffKind::Annotation)),
            ("extensions", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ApiWire",
        &[
            ("int64", MemberRow::Kind(DiffKind::TypeChanged)),
            ("outputEnums", MemberRow::Kind(DiffKind::TypeChanged)),
            ("urls", MemberRow::Kind(DiffKind::TypeChanged)),
        ],
    ),
    (
        "ConventionValue",
        &[
            ("value", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "ExtensionKeyDecl",
        &[
            ("id", MemberRow::Kind(DiffKind::Annotation)),
            ("prefix", MemberRow::Kind(DiffKind::Annotation)),
            ("key", MemberRow::Kind(DiffKind::Annotation)),
            ("schema", MemberRow::Kind(DiffKind::Annotation)),
            ("places", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "LintRule",
        &[
            ("severity", MemberRow::Kind(DiffKind::Annotation)),
            ("origin", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "LintAllow",
        &[
            ("rule", MemberRow::Kind(DiffKind::Annotation)),
            ("at", MemberRow::Kind(DiffKind::Annotation)),
            ("reason", MemberRow::Kind(DiffKind::Annotation)),
            ("subtree", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
    (
        "Lint",
        &[
            ("rules", MemberRow::Kind(DiffKind::Annotation)),
            ("allows", MemberRow::Kind(DiffKind::Annotation)),
        ],
    ),
];
