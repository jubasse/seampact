//! The `params` of an operation: path, query and header parameters, read from fields and checked against the path.

use seampact_diagnostics::DiagnosticOrigin;
use seampact_ir::{Origin, Param, Params, TypeUse, UnknownQuery};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeNode};

use crate::fields::{TreeNodesField, TreeNodesFields, TreeNodesSite};
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;
use crate::paths::TreeNodesPath;

/// The three parameter lists of an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParamList {
    Path,
    Query,
    Header,
}

/// How a message names each list.
const PLACE: &[(ParamList, &str)] = &[
    (ParamList::Path, "path parameter"),
    (ParamList::Query, "query field"),
    (ParamList::Header, "request header"),
];
/// A path placeholder: `{name}`.
const PLACEHOLDER: &str = r"\{([^{}]+)\}";
/// The `unknownQuery` policy value that refuses.
const REFUSE: &str = "refuse";

fn placeholders_of(_text: &str) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("placeholdersOf"))
}

pub(crate) fn tree_nodes_unknown_query(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<UnknownQuery, PassError> {
    Err(not_ported_yet("treeNodesUnknownQuery"))
}

fn chain_of<'run>(
    _node: &TreeNode<'_>,
    _scope: &TreeNodesScope<'_, '_, 'run>,
) -> Result<Vec<&'run TreeNode<'run>>, PassError> {
    Err(not_ported_yet("chainOf"))
}

fn policy_of(
    _value: Option<&JsonValue>,
    _origin: Option<&Origin>,
) -> Result<UnknownQuery, PassError> {
    Err(not_ported_yet("policyOf"))
}

fn inherited_fields(
    _site: &TreeNodesSite<'_, '_>,
    _setting: &str,
    _reaches: &dyn Fn(&TreeNode<'_>) -> bool,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<TreeNodesField>, PassError> {
    Err(not_ported_yet("inheritedFields"))
}

fn check_tag_header_not_declared(
    _site: &TreeNodesSite<'_, '_>,
    _headers: &[Param],
    _input: Option<&TypeUse>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkTagHeaderNotDeclared"))
}

fn params_of(
    _site: &TreeNodesSite<'_, '_>,
    _fields: &[TreeNodesField],
    _list: ParamList,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Param>, PassError> {
    Err(not_ported_yet("paramsOf"))
}

pub(crate) fn tree_nodes_params(
    _site: &TreeNodesSite<'_, '_>,
    _path: Option<&TreeNodesPath>,
    _safe: bool,
    _input: Option<&TypeUse>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Params, PassError> {
    Err(not_ported_yet("treeNodesParams"))
}

fn check_query_not_named_like_path(
    _site: &TreeNodesSite<'_, '_>,
    _path_fields: &[TreeNodesField],
    _query_fields: &[TreeNodesField],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkQueryNotNamedLikePath"))
}

fn path_param_fields(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    Err(not_ported_yet("pathParamFields"))
}

fn check_placeholders(
    _site: &TreeNodesSite<'_, '_>,
    _path: &TreeNodesPath,
    _path_fields: &TreeNodesFields,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkPlaceholders"))
}

fn param_of(
    _site: &TreeNodesSite<'_, '_>,
    _field: &TreeNodesField,
    _param_type: &TypeUse,
    _list: ParamList,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Param>, PassError> {
    Err(not_ported_yet("paramOf"))
}

fn report_undeclared_placeholder(
    _site: &TreeNodesSite<'_, '_>,
    _path: &str,
    _placeholder: &str,
    _origin: &DiagnosticOrigin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportUndeclaredPlaceholder"))
}

fn report_twice(
    _site: &TreeNodesSite<'_, '_>,
    _field: &TreeNodesField,
    _first: &TreeNodesField,
    _list: ParamList,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportTwice"))
}

fn report_repeated_placeholder(
    _site: &TreeNodesSite<'_, '_>,
    _path: &str,
    _placeholder: &str,
    _origin: &DiagnosticOrigin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRepeatedPlaceholder"))
}
