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
/// The `unknownQuery` policy value that refuses.
const REFUSE: &str = "refuse";

/// The names of the `{name}` placeholders of a text, in order, repeats included.
///
/// A name holds no brace; the TypeScript's `/\{([^{}]+)\}/g`.
pub(crate) fn placeholders_of(text: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut rest = text;

    while let Some((_, after_open)) = rest.split_once('{') {
        let Some(close) = after_open.find(['{', '}']) else {
            break;
        };
        let (name, from_close) = after_open.split_at(close);

        match from_close.strip_prefix('}') {
            Some(after_close) if !name.is_empty() => {
                names.push(name);
                rest = after_close;
            }
            _ => rest = after_open,
        }
    }

    names
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

/// The text with each `{name}` placeholder written `{}`: a path compared by position only.
pub(crate) fn blank_placeholders(text: &str) -> String {
    let mut blanked = String::new();
    let mut rest = text;

    while let Some((before, after_open)) = rest.split_once('{') {
        blanked.push_str(before);

        let close = after_open.find(['{', '}']);
        let name_and_rest = close.map(|close| after_open.split_at(close));

        match name_and_rest.and_then(|(name, from_close)| Some((name, from_close.strip_prefix('}')?))) {
            Some((name, after_close)) if !name.is_empty() => {
                blanked.push_str("{}");
                rest = after_close;
            }
            _ => {
                blanked.push('{');
                rest = after_open;
            }
        }
    }

    blanked.push_str(rest);

    blanked
}
