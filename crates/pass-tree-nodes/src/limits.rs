//! Body limits: a route's limit in bytes, and the limits the size grammar admits but no safe integer holds.

use seampact_ir::Origin;
use seampact_json::JsonValue;
use seampact_pipeline::{Inherited, PassError, ResolvedConventions, TreeNode};

use crate::not_ported::not_ported_yet;
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

/// The body limit of a route in bytes and where it is written, absent when none applies.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub fn tree_nodes_body_limit(
    _node: &TreeNode<'_>,
    _context: &TreeNodesBodyLimitContext<'_, '_>,
) -> Result<Option<TreeNodesBodyLimit>, PassError> {
    Err(not_ported_yet("treeNodesBodyLimit"))
}

fn parsed_body_limit(
    _value: &JsonValue,
    _origin: Option<&Origin>,
    _written_at: &str,
) -> Result<Option<TreeNodesBodyLimit>, PassError> {
    Err(not_ported_yet("parsedBodyLimit"))
}

pub(crate) fn tree_nodes_check_body_limits(
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckBodyLimits"))
}

fn check_limit(
    _value: &JsonValue,
    _origin: &Origin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkLimit"))
}
