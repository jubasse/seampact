//! The path of an operation: each part of it, written or derived, and the checks of the parts a router reads.

use seampact_ir::Origin;
use seampact_pipeline::{PassError, ResolvedConventions, TreeNode};

use crate::api::TreeNodesSurfacePrefixes;
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The case path segments are written in (`conventions.pathCase`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathCase {
    Kebab,
    Camel,
    Snake,
}

const PATH_CASES: &[PathCase] = &[PathCase::Kebab, PathCase::Camel, PathCase::Snake];

/// One check of a written path part: what it refuses and how a message says it.
struct PathSegmentCheck {
    refuses: fn(&str) -> bool,
    why: &'static str,
}

/// A written path is relative segments the router reads as written: no leading `/`, no empty, `.` or `..`
/// segment, and no `?`, `#` or `%`, which a URL reads as a query, a fragment or an escape.
const PATH_SEGMENT_CHECKS: &[PathSegmentCheck] = &[
    PathSegmentCheck {
        refuses: |text| text.starts_with('/'),
        why: "starts with /",
    },
    PathSegmentCheck {
        refuses: |text| !text.is_empty() && text.split('/').any(str::is_empty),
        why: "holds an empty segment",
    },
    PathSegmentCheck {
        refuses: |text| {
            text.split('/')
                .any(|segment| segment == "." || segment == "..")
        },
        why: "holds a . or .. segment",
    },
    PathSegmentCheck {
        refuses: |text| text.contains(['?', '#', '%']),
        why: "holds ?, # or %",
    },
];

/// One part of an operation's path.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeNodesPathPart {
    pub(crate) text: String,
    pub(crate) origin: Origin,
    /// Written by the author (a node's or op's `path`, `conventions.ops.<op>.path`), not derived from a name or id.
    pub(crate) written: bool,
}

/// An operation's full path with its surface prefix and its parts.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeNodesPath {
    pub(crate) full: String,
    pub(crate) prefix: String,
    pub(crate) parts: Vec<TreeNodesPathPart>,
}

/// What the part functions need besides the node: the case segments are derived in.
#[derive(Debug, Clone, Copy)]
struct PathSite {
    path_case: PathCase,
}

fn segment_of_name(_name: &str, _path_case: PathCase) -> Result<String, PassError> {
    Err(not_ported_yet("segmentOfName"))
}

fn path_case_of(_conventions: ResolvedConventions<'_>) -> Result<PathCase, PassError> {
    Err(not_ported_yet("pathCaseOf"))
}

pub(crate) fn tree_nodes_check_path_parts(
    _site: &TreeNodesSite<'_, '_>,
    _path: &TreeNodesPath,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckPathParts"))
}

fn part_of(
    _site: PathSite,
    _node: &TreeNode<'_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    Err(not_ported_yet("partOf"))
}

pub(crate) fn tree_nodes_path(
    _node: &TreeNode<'_>,
    _prefixes: &TreeNodesSurfacePrefixes,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPath, PassError> {
    Err(not_ported_yet("treeNodesPath"))
}

fn written_part(
    _site: PathSite,
    _node: &TreeNode<'_>,
    _text: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    Err(not_ported_yet("writtenPart"))
}

fn op_part(
    _site: PathSite,
    _node: &TreeNode<'_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    Err(not_ported_yet("opPart"))
}
