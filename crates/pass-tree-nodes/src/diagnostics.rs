//! The diagnostics of the half: its rules, their ids and the helpers that build and locate them.

use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_ir::Origin;

use crate::pass::TreeNodesScope;

/// A rule of the half, reported as `seampact/tree/<rule>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum TreeNodesRule {
    CollectionSingular,
    CollectionId,
    OperationIdUnique,
    OperationNameUnique,
    RouteUnique,
    OpInput,
    GetInput,
    OpItem,
    IdProperty,
    InputFile,
    InputFileSize,
    BodyLimit,
    FormInput,
    FormField,
    ApiVersion,
    PathVersion,
    PathParam,
    PathSegment,
    ParamUnique,
    QueryField,
    FieldsSchema,
    OpaquePosition,
    UnionHeader,
    RedirectBody,
    ResponsesOutput,
    NoContentBody,
    OwnerConcurrency,
    ConcurrencyInherit,
    ConcurrencyInput,
    PagingList,
    PagingStyle,
    PagingUnknown,
    PagingParam,
    PagingSort,
    PagingLimit,
    PagingToken,
    SortKey,
    SortKeySigned,
    DegradablePath,
    DegradableHeader,
    BudgetDuration,
    DeprecatedSince,
    DeprecatedSunset,
    DeprecatedSuccessor,
    DeprecatedSuccessorParams,
    UpstreamService,
    InternalProduct,
    FormatUnknown,
    FormatMeta,
    FormatErrorCode,
    FormatId,
    FormatMerge,
    FormatEach,
    FormatMember,
    TemplateSlot,
    TemplateSyntax,
    TemplateMerge,
    TemplateEach,
    TemplateName,
    PagingReserved,
    PagingPosition,
    PagingRequest,
    PagingItems,
    PagingRole,
    PagingLink,
    PagingMeta,
    PagingMetaClash,
    ExampleTarget,
    ExampleValue,
    RelayTarget,
    RelayName,
    RelayUnknown,
    RelayDeclaration,
}

impl TreeNodesRule {
    /// Every rule of the half, in declaration order.
    pub(crate) const ALL: &[Self] = &[
        Self::CollectionSingular,
        Self::CollectionId,
        Self::OperationIdUnique,
        Self::OperationNameUnique,
        Self::RouteUnique,
        Self::OpInput,
        Self::GetInput,
        Self::OpItem,
        Self::IdProperty,
        Self::InputFile,
        Self::InputFileSize,
        Self::BodyLimit,
        Self::FormInput,
        Self::FormField,
        Self::ApiVersion,
        Self::PathVersion,
        Self::PathParam,
        Self::PathSegment,
        Self::ParamUnique,
        Self::QueryField,
        Self::FieldsSchema,
        Self::OpaquePosition,
        Self::UnionHeader,
        Self::RedirectBody,
        Self::ResponsesOutput,
        Self::NoContentBody,
        Self::OwnerConcurrency,
        Self::ConcurrencyInherit,
        Self::ConcurrencyInput,
        Self::PagingList,
        Self::PagingStyle,
        Self::PagingUnknown,
        Self::PagingParam,
        Self::PagingSort,
        Self::PagingLimit,
        Self::PagingToken,
        Self::SortKey,
        Self::SortKeySigned,
        Self::DegradablePath,
        Self::DegradableHeader,
        Self::BudgetDuration,
        Self::DeprecatedSince,
        Self::DeprecatedSunset,
        Self::DeprecatedSuccessor,
        Self::DeprecatedSuccessorParams,
        Self::UpstreamService,
        Self::InternalProduct,
        Self::FormatUnknown,
        Self::FormatMeta,
        Self::FormatErrorCode,
        Self::FormatId,
        Self::FormatMerge,
        Self::FormatEach,
        Self::FormatMember,
        Self::TemplateSlot,
        Self::TemplateSyntax,
        Self::TemplateMerge,
        Self::TemplateEach,
        Self::TemplateName,
        Self::PagingReserved,
        Self::PagingPosition,
        Self::PagingRequest,
        Self::PagingItems,
        Self::PagingRole,
        Self::PagingLink,
        Self::PagingMeta,
        Self::PagingMetaClash,
        Self::ExampleTarget,
        Self::ExampleValue,
        Self::RelayTarget,
        Self::RelayName,
        Self::RelayUnknown,
        Self::RelayDeclaration,
    ];

    /// The rule as a diagnostic's rule id.
    #[must_use]
    pub(crate) const fn rule_id(self) -> RuleId {
        RuleId::from_static(match self {
            Self::CollectionSingular => "seampact/tree/collection-singular",
            Self::CollectionId => "seampact/tree/collection-id",
            Self::OperationIdUnique => "seampact/tree/operation-id-unique",
            Self::OperationNameUnique => "seampact/tree/operation-name-unique",
            Self::RouteUnique => "seampact/tree/route-unique",
            Self::OpInput => "seampact/tree/op-input",
            Self::GetInput => "seampact/tree/get-input",
            Self::OpItem => "seampact/tree/op-item",
            Self::IdProperty => "seampact/tree/id-property",
            Self::InputFile => "seampact/tree/input-file",
            Self::InputFileSize => "seampact/tree/input-file-size",
            Self::BodyLimit => "seampact/tree/body-limit",
            Self::FormInput => "seampact/tree/form-input",
            Self::FormField => "seampact/tree/form-field",
            Self::ApiVersion => "seampact/tree/api-version",
            Self::PathVersion => "seampact/tree/path-version",
            Self::PathParam => "seampact/tree/path-param",
            Self::PathSegment => "seampact/tree/path-segment",
            Self::ParamUnique => "seampact/tree/param-unique",
            Self::QueryField => "seampact/tree/query-field",
            Self::FieldsSchema => "seampact/tree/fields-schema",
            Self::OpaquePosition => "seampact/tree/opaque-position",
            Self::UnionHeader => "seampact/tree/union-header",
            Self::RedirectBody => "seampact/tree/redirect-body",
            Self::ResponsesOutput => "seampact/tree/responses-output",
            Self::NoContentBody => "seampact/tree/no-content-body",
            Self::OwnerConcurrency => "seampact/tree/owner-concurrency",
            Self::ConcurrencyInherit => "seampact/tree/concurrency-inherit",
            Self::ConcurrencyInput => "seampact/tree/concurrency-input",
            Self::PagingList => "seampact/tree/paging-list",
            Self::PagingStyle => "seampact/tree/paging-style",
            Self::PagingUnknown => "seampact/tree/paging-unknown",
            Self::PagingParam => "seampact/tree/paging-param",
            Self::PagingSort => "seampact/tree/paging-sort",
            Self::PagingLimit => "seampact/tree/paging-limit",
            Self::PagingToken => "seampact/tree/paging-token",
            Self::SortKey => "seampact/tree/sort-key",
            Self::SortKeySigned => "seampact/tree/sort-key-signed",
            Self::DegradablePath => "seampact/tree/degradable-path",
            Self::DegradableHeader => "seampact/tree/degradable-header",
            Self::BudgetDuration => "seampact/tree/budget-duration",
            Self::DeprecatedSince => "seampact/tree/deprecated-since",
            Self::DeprecatedSunset => "seampact/tree/deprecated-sunset",
            Self::DeprecatedSuccessor => "seampact/tree/deprecated-successor",
            Self::DeprecatedSuccessorParams => "seampact/tree/deprecated-successor-params",
            Self::UpstreamService => "seampact/tree/upstream-service",
            Self::InternalProduct => "seampact/tree/internal-product",
            Self::FormatUnknown => "seampact/tree/format-unknown",
            Self::FormatMeta => "seampact/tree/format-meta",
            Self::FormatErrorCode => "seampact/tree/format-error-code",
            Self::FormatId => "seampact/tree/format-id",
            Self::FormatMerge => "seampact/tree/format-merge",
            Self::FormatEach => "seampact/tree/format-each",
            Self::FormatMember => "seampact/tree/format-member",
            Self::TemplateSlot => "seampact/tree/template-slot",
            Self::TemplateSyntax => "seampact/tree/template-syntax",
            Self::TemplateMerge => "seampact/tree/template-merge",
            Self::TemplateEach => "seampact/tree/template-each",
            Self::TemplateName => "seampact/tree/template-name",
            Self::PagingReserved => "seampact/tree/paging-reserved",
            Self::PagingPosition => "seampact/tree/paging-position",
            Self::PagingRequest => "seampact/tree/paging-request",
            Self::PagingItems => "seampact/tree/paging-items",
            Self::PagingRole => "seampact/tree/paging-role",
            Self::PagingLink => "seampact/tree/paging-link",
            Self::PagingMeta => "seampact/tree/paging-meta",
            Self::PagingMetaClash => "seampact/tree/paging-meta-clash",
            Self::ExampleTarget => "seampact/tree/example-target",
            Self::ExampleValue => "seampact/tree/example-value",
            Self::RelayTarget => "seampact/tree/relay-target",
            Self::RelayName => "seampact/tree/relay-name",
            Self::RelayUnknown => "seampact/tree/relay-unknown",
            Self::RelayDeclaration => "seampact/tree/relay-declaration",
        })
    }
}

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    TreeNodesRule::CollectionSingular.rule_id(),
    TreeNodesRule::CollectionId.rule_id(),
    TreeNodesRule::OperationIdUnique.rule_id(),
    TreeNodesRule::OperationNameUnique.rule_id(),
    TreeNodesRule::RouteUnique.rule_id(),
    TreeNodesRule::OpInput.rule_id(),
    TreeNodesRule::GetInput.rule_id(),
    TreeNodesRule::OpItem.rule_id(),
    TreeNodesRule::IdProperty.rule_id(),
    TreeNodesRule::InputFile.rule_id(),
    TreeNodesRule::InputFileSize.rule_id(),
    TreeNodesRule::BodyLimit.rule_id(),
    TreeNodesRule::FormInput.rule_id(),
    TreeNodesRule::FormField.rule_id(),
    TreeNodesRule::ApiVersion.rule_id(),
    TreeNodesRule::PathVersion.rule_id(),
    TreeNodesRule::PathParam.rule_id(),
    TreeNodesRule::PathSegment.rule_id(),
    TreeNodesRule::ParamUnique.rule_id(),
    TreeNodesRule::QueryField.rule_id(),
    TreeNodesRule::FieldsSchema.rule_id(),
    TreeNodesRule::OpaquePosition.rule_id(),
    TreeNodesRule::UnionHeader.rule_id(),
    TreeNodesRule::RedirectBody.rule_id(),
    TreeNodesRule::ResponsesOutput.rule_id(),
    TreeNodesRule::NoContentBody.rule_id(),
    TreeNodesRule::OwnerConcurrency.rule_id(),
    TreeNodesRule::ConcurrencyInherit.rule_id(),
    TreeNodesRule::ConcurrencyInput.rule_id(),
    TreeNodesRule::PagingList.rule_id(),
    TreeNodesRule::PagingStyle.rule_id(),
    TreeNodesRule::PagingUnknown.rule_id(),
    TreeNodesRule::PagingParam.rule_id(),
    TreeNodesRule::PagingSort.rule_id(),
    TreeNodesRule::PagingLimit.rule_id(),
    TreeNodesRule::PagingToken.rule_id(),
    TreeNodesRule::SortKey.rule_id(),
    TreeNodesRule::SortKeySigned.rule_id(),
    TreeNodesRule::DegradablePath.rule_id(),
    TreeNodesRule::DegradableHeader.rule_id(),
    TreeNodesRule::BudgetDuration.rule_id(),
    TreeNodesRule::DeprecatedSince.rule_id(),
    TreeNodesRule::DeprecatedSunset.rule_id(),
    TreeNodesRule::DeprecatedSuccessor.rule_id(),
    TreeNodesRule::DeprecatedSuccessorParams.rule_id(),
    TreeNodesRule::UpstreamService.rule_id(),
    TreeNodesRule::InternalProduct.rule_id(),
    TreeNodesRule::FormatUnknown.rule_id(),
    TreeNodesRule::FormatMeta.rule_id(),
    TreeNodesRule::FormatErrorCode.rule_id(),
    TreeNodesRule::FormatId.rule_id(),
    TreeNodesRule::FormatMerge.rule_id(),
    TreeNodesRule::FormatEach.rule_id(),
    TreeNodesRule::FormatMember.rule_id(),
    TreeNodesRule::TemplateSlot.rule_id(),
    TreeNodesRule::TemplateSyntax.rule_id(),
    TreeNodesRule::TemplateMerge.rule_id(),
    TreeNodesRule::TemplateEach.rule_id(),
    TreeNodesRule::TemplateName.rule_id(),
    TreeNodesRule::PagingReserved.rule_id(),
    TreeNodesRule::PagingPosition.rule_id(),
    TreeNodesRule::PagingRequest.rule_id(),
    TreeNodesRule::PagingItems.rule_id(),
    TreeNodesRule::PagingRole.rule_id(),
    TreeNodesRule::PagingLink.rule_id(),
    TreeNodesRule::PagingMeta.rule_id(),
    TreeNodesRule::PagingMetaClash.rule_id(),
    TreeNodesRule::ExampleTarget.rule_id(),
    TreeNodesRule::ExampleValue.rule_id(),
    TreeNodesRule::RelayTarget.rule_id(),
    TreeNodesRule::RelayName.rule_id(),
    TreeNodesRule::RelayUnknown.rule_id(),
    TreeNodesRule::RelayDeclaration.rule_id(),
];

/// What `treeNodesError` and `treeNodesWarning` build a diagnostic from.
#[derive(Debug, Clone)]
pub(crate) struct TreeNodesDiagnosticOptions {
    /// The rule reported.
    pub(crate) rule: TreeNodesRule,
    /// Where the diagnostic points.
    pub(crate) origin: DiagnosticOrigin,
    /// What is wrong.
    pub(crate) message: String,
    /// How to fix it.
    pub(crate) fix: String,
    /// The other locations the diagnostic names.
    pub(crate) related: Vec<RelatedLocation>,
}

/// The origin a diagnostic is located at: `origin`, or `fallback` for a core declaration.
pub(crate) fn tree_nodes_locate(origin: &Origin, fallback: &DiagnosticOrigin) -> DiagnosticOrigin {
    DiagnosticOrigin::of(origin).unwrap_or_else(|| fallback.clone())
}

/// An origin of the merged raw tree as a diagnostic origin; a tree node's origin is never core.
///
/// # Errors
///
/// An [`InternalError`] for a core origin.
pub(crate) fn tree_nodes_node_origin(origin: &Origin) -> Result<DiagnosticOrigin, InternalError> {
    DiagnosticOrigin::of(origin).ok_or_else(|| {
        InternalError::new(format!(
            "a tree node has a core origin ({}); every node is written in a layer",
            origin.pointer
        ))
    })
}

/// An error diagnostic of the half.
pub(crate) fn tree_nodes_error(options: TreeNodesDiagnosticOptions) -> Diagnostic {
    Diagnostic {
        severity: Severity::Error,
        rule: options.rule.rule_id(),
        message: options.message,
        fix: options.fix,
        origin: options.origin,
        related: options.related,
    }
}

/// A warning diagnostic of the half.
pub(crate) fn tree_nodes_warning(options: TreeNodesDiagnosticOptions) -> Diagnostic {
    Diagnostic {
        severity: Severity::Warning,
        ..tree_nodes_error(options)
    }
}

/// Reports `diagnostic` the first time `key` is seen in a run of the half, and drops it after that.
pub(crate) fn tree_nodes_report_once(
    key: &str,
    diagnostic: Diagnostic,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    if !scope.reported_once.insert(key.to_owned()) {
        return;
    }

    scope.context.report(diagnostic);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_ids_are_every_rule_mapped_through_rule_id() {
        let mapped: Vec<RuleId> = TreeNodesRule::ALL
            .iter()
            .map(|rule| rule.rule_id())
            .collect();

        assert_eq!(RULE_IDS, mapped.as_slice());
    }

    #[test]
    fn a_core_origin_has_no_diagnostic_origin() {
        let core = Origin {
            layer: seampact_ir::Layer::Core,
            pointer: "/x".to_owned(),
            api: None,
        };

        assert!(tree_nodes_node_origin(&core).is_err());
    }
}
