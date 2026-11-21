//! The kinds of change the classification table has a row for.

/// A row of the classification table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffKind {
    /// `operation.added`.
    OperationAdded,
    /// `operation.removed`.
    OperationRemoved,
    /// `operation.route`.
    OperationRoute,
    /// `operation.format`.
    OperationFormat,
    /// `property.added`.
    PropertyAdded,
    /// `property.removed`.
    PropertyRemoved,
    /// `property.required`.
    PropertyRequired,
    /// `nullable`.
    Nullable,
    /// `type.changed`.
    TypeChanged,
    /// `refinement`.
    Refinement,
    /// `pattern.changed`.
    PatternChanged,
    /// `enum.value`.
    EnumValue,
    /// `union.variant`.
    UnionVariant,
    /// `union.tag`.
    UnionTag,
    /// `default.changed`.
    DefaultChanged,
    /// `param.added`.
    ParamAdded,
    /// `param.removed`.
    ParamRemoved,
    /// `param.required`.
    ParamRequired,
    /// `unknownQuery`.
    UnknownQuery,
    /// `unknownKeys`.
    UnknownKeys,
    /// `body`.
    Body,
    /// `proof`.
    Proof,
    /// `response`.
    Response,
    /// `responseHeader.added`.
    ResponseHeaderAdded,
    /// `responseHeader.removed`.
    ResponseHeaderRemoved,
    /// `responseHeader.required`.
    ResponseHeaderRequired,
    /// `responseHeader.semantic`.
    ResponseHeaderSemantic,
    /// `access`.
    Access,
    /// `callerKind`.
    CallerKind,
    /// `principalRequirement`.
    PrincipalRequirement,
    /// `scope`.
    Scope,
    /// `requirement`.
    Requirement,
    /// `binding`.
    Binding,
    /// `csrf`.
    Csrf,
    /// `owner`.
    Owner,
    /// `concurrency`.
    Concurrency,
    /// `fieldRight`.
    FieldRight,
    /// `filteredBy`.
    FilteredBy,
    /// `idempotency`.
    Idempotency,
    /// `paging`.
    Paging,
    /// `error`.
    Error,
    /// `declaration`.
    Declaration,
    /// `format`.
    Format,
    /// `pagingStyle`.
    PagingStyle,
    /// `scheme`.
    Scheme,
    /// `identity`.
    Identity,
    /// `right`.
    Right,
    /// `rule`.
    Rule,
    /// `bucket`.
    Bucket,
    /// `header`.
    Header,
    /// `maturity`.
    Maturity,
    /// `deprecation`.
    Deprecation,
    /// `compat.policy`.
    CompatPolicy,
    /// `pack.upgraded`.
    PackUpgraded,
    /// `order`.
    Order,
    /// `name`.
    Name,
    /// `annotation`.
    Annotation,
    /// `unclassified`.
    Unclassified,
}

impl DiffKind {
    /// The kind as the report and the table write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OperationAdded => "operation.added",
            Self::OperationRemoved => "operation.removed",
            Self::OperationRoute => "operation.route",
            Self::OperationFormat => "operation.format",
            Self::PropertyAdded => "property.added",
            Self::PropertyRemoved => "property.removed",
            Self::PropertyRequired => "property.required",
            Self::Nullable => "nullable",
            Self::TypeChanged => "type.changed",
            Self::Refinement => "refinement",
            Self::PatternChanged => "pattern.changed",
            Self::EnumValue => "enum.value",
            Self::UnionVariant => "union.variant",
            Self::UnionTag => "union.tag",
            Self::DefaultChanged => "default.changed",
            Self::ParamAdded => "param.added",
            Self::ParamRemoved => "param.removed",
            Self::ParamRequired => "param.required",
            Self::UnknownQuery => "unknownQuery",
            Self::UnknownKeys => "unknownKeys",
            Self::Body => "body",
            Self::Proof => "proof",
            Self::Response => "response",
            Self::ResponseHeaderAdded => "responseHeader.added",
            Self::ResponseHeaderRemoved => "responseHeader.removed",
            Self::ResponseHeaderRequired => "responseHeader.required",
            Self::ResponseHeaderSemantic => "responseHeader.semantic",
            Self::Access => "access",
            Self::CallerKind => "callerKind",
            Self::PrincipalRequirement => "principalRequirement",
            Self::Scope => "scope",
            Self::Requirement => "requirement",
            Self::Binding => "binding",
            Self::Csrf => "csrf",
            Self::Owner => "owner",
            Self::Concurrency => "concurrency",
            Self::FieldRight => "fieldRight",
            Self::FilteredBy => "filteredBy",
            Self::Idempotency => "idempotency",
            Self::Paging => "paging",
            Self::Error => "error",
            Self::Declaration => "declaration",
            Self::Format => "format",
            Self::PagingStyle => "pagingStyle",
            Self::Scheme => "scheme",
            Self::Identity => "identity",
            Self::Right => "right",
            Self::Rule => "rule",
            Self::Bucket => "bucket",
            Self::Header => "header",
            Self::Maturity => "maturity",
            Self::Deprecation => "deprecation",
            Self::CompatPolicy => "compat.policy",
            Self::PackUpgraded => "pack.upgraded",
            Self::Order => "order",
            Self::Name => "name",
            Self::Annotation => "annotation",
            Self::Unclassified => "unclassified",
        }
    }
}
