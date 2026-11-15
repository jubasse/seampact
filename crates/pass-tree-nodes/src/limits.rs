//! Body limits: a route's limit in bytes, and the limits the size grammar admits but no safe integer holds.

use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_written_convention;
use seampact_pipeline::{
    Inherited, NearestSetting, ResolvedConventions, TreeNode, TreeNodeId, TreeNodeKind, parse_size,
    pipeline_tree_nodes,
};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::js_text::js_text_of;
use crate::pass::TreeNodesScope;

/// The conventions that hold a body limit.
const LIMIT_CONVENTIONS: &[&str] = &["bodyLimit", "batch.bodyLimit"];
const BYTES_PER_MIB: i64 = 1 << 20;
/// The largest limit, in MiB, whose byte count is a safe integer.
const LARGEST_CHECKED_MIB: i64 = (1 << 53) / BYTES_PER_MIB - 1;

/// A route's body limit in bytes, and where it is written.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesBodyLimit {
    /// The limit in bytes.
    pub bytes: i64,
    /// Absent for the core default.
    pub origin: Option<Origin>,
}

/// What `treeNodesBodyLimit` reads besides the node: the inherited settings and the conventions.
#[derive(Debug, Clone, Copy)]
pub struct TreeNodesBodyLimitContext<'half, 'run> {
    /// The inherited settings of the api.
    pub inherited: &'half Inherited<'run>,
    /// The resolved conventions of the api.
    pub conventions: &'half ResolvedConventions<'run>,
}

/// The body limit of a route in bytes and where it is written, absent when none applies or the
/// written limit does not parse (`tree_nodes_check_body_limits` reports it).
///
/// # Errors
///
/// An [`InternalError`] for a node of another api, a default that does not parse or a limit past
/// `i64`.
pub fn tree_nodes_body_limit(
    node_id: TreeNodeId,
    node: &TreeNode<'_>,
    context: &TreeNodesBodyLimitContext<'_, '_>,
) -> Result<Option<TreeNodesBodyLimit>, InternalError> {
    if let Some(inherited) = context
        .inherited
        .nearest(node_id, &NearestSetting::BodyLimit)?
    {
        return parsed_body_limit(
            inherited.value,
            Some(&inherited.origin),
            &inherited.origin.pointer,
        );
    }

    let is_batch = node.kind == TreeNodeKind::Op && node.name == "batch";
    let convention = if is_batch {
        "batch.bodyLimit"
    } else {
        "bodyLimit"
    };
    let Some(reading) = context.conventions.get(convention)? else {
        return Ok(None);
    };
    let written_at = reading.origin.as_ref().map_or_else(
        || format!("the default conventions.{convention}"),
        |origin| origin.pointer.clone(),
    );

    parsed_body_limit(reading.value, reading.origin.as_ref(), &written_at)
}

fn parsed_body_limit(
    value: &JsonValue,
    origin: Option<&Origin>,
    written_at: &str,
) -> Result<Option<TreeNodesBodyLimit>, InternalError> {
    let bytes = match value {
        JsonValue::String(text) => parse_size(text)?,
        _ => None,
    };

    if let Some(bytes) = bytes {
        let bytes = i64::try_from(bytes).map_err(|_| {
            InternalError::new(format!(
                "the body limit at {written_at} is past i64: {bytes}"
            ))
        })?;

        return Ok(Some(TreeNodesBodyLimit {
            bytes,
            origin: origin.cloned(),
        }));
    }

    if origin.is_none() {
        return Err(InternalError::new(format!(
            "the body limit at {written_at} does not parse as a size: {}",
            js_text_of(Some(value))
        )));
    }

    Ok(None)
}

/// Reports every written body limit that does not parse as a size.
pub(crate) fn tree_nodes_check_body_limits(
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let raw = scope.context.raw;

    for (_, node) in pipeline_tree_nodes(raw)?.iter() {
        let Some(value) = node.settings.get("bodyLimit") else {
            continue;
        };
        let origin = scope
            .context
            .origin(&format!("{}/bodyLimit", node.pointer))
            .unwrap_or_else(|| node.origin.clone());

        check_limit(value, &origin, scope)?;
    }

    let conventions = scope.context.conventions;

    for path in LIMIT_CONVENTIONS {
        if let Some(reading) = tree_nodes_written_convention(*conventions, path)? {
            check_limit(reading.value, &reading.origin, scope)?;
        }
    }

    Ok(())
}

fn check_limit(
    value: &JsonValue,
    origin: &Origin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    if let JsonValue::String(text) = value
        && parse_size(text)?.is_some()
    {
        return Ok(());
    }

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::BodyLimit,
            origin: tree_nodes_node_origin(origin)?,
            message: format!(
                "The body limit {} is larger than any size the compiler can check.",
                js_text_of(Some(value))
            ),
            fix: format!("Write a smaller bodyLimit, at most {LARGEST_CHECKED_MIB}MiB."),
            related: Vec::new(),
        }));

    Ok(())
}
