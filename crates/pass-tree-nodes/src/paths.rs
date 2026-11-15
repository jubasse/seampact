//! The path of an operation: each part of it, written or derived, and the checks of the parts a router reads.

use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_json::JsonValue;
use seampact_naming::{NamingError, OperationIdCase, operation_id, split_name};
use seampact_pass_tree_shared::{tree_nodes_id_param, tree_nodes_op_shorthand, tree_nodes_text};
use seampact_pipeline::{PassError, ResolvedConventions, TreeNode, TreeNodeKind, TreeNodes};

use crate::api::TreeNodesSurfacePrefixes;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_locate,
    tree_nodes_node_origin, tree_nodes_report_once,
};
use crate::fields::TreeNodesSite;
use crate::pass::TreeNodesScope;

/// The member of a scope node that holds one operation's collection members.
const MEMBER_SCOPE: &str = "member";

/// The case path segments are written in (`conventions.pathCase`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathCase {
    Kebab,
    Camel,
    Snake,
}

const PATH_CASES: &[PathCase] = &[PathCase::Kebab, PathCase::Camel, PathCase::Snake];

impl PathCase {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Kebab => "kebab",
            Self::Camel => "camel",
            Self::Snake => "snake",
        }
    }
}

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

fn segment_of_name(name: &str, path_case: PathCase) -> Result<String, NamingError> {
    let words = split_name(name);

    match path_case {
        PathCase::Camel => operation_id(&words, OperationIdCase::Camel),
        PathCase::Kebab => Ok(words.join("-")),
        PathCase::Snake => Ok(words.join("_")),
    }
}

fn path_case_of(conventions: ResolvedConventions<'_>) -> Result<PathCase, PassError> {
    let written = conventions.get("pathCase")?.map(|reading| reading.value);
    let path_case = PATH_CASES
        .iter()
        .find(|candidate| written == Some(&JsonValue::String(candidate.as_str().to_owned())));

    match path_case {
        Some(path_case) => Ok(*path_case),
        None => Err(InternalError::new(
            "conventions.pathCase resolves to no case the grammar admits".to_owned(),
        )
        .into()),
    }
}

/// Reports, once where it is written, each written path part a router would not read as relative segments.
pub(crate) fn tree_nodes_check_path_parts(
    site: &TreeNodesSite<'_, '_>,
    path: &TreeNodesPath,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    for part in path.parts.iter().filter(|part| part.written) {
        let Some(check) = PATH_SEGMENT_CHECKS
            .iter()
            .find(|check| (check.refuses)(&part.text))
        else {
            continue;
        };
        let fallback = tree_nodes_node_origin(&site.node.origin)?;
        let origin = tree_nodes_locate(&part.origin, &fallback);
        let key = format!("path-segment:{}#{}", origin.layer, origin.pointer);
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PathSegment,
            origin,
            message: format!(
                "The path {} written for {} {}; a path is relative segments.",
                part.text, site.operation_id, check.why
            ),
            fix: "Write the path as segments separated by /, without / at either end, ., .., ?, # or %."
                .to_owned(),
            related: Vec::new(),
        });

        tree_nodes_report_once(&key, diagnostic, scope);
    }

    Ok(())
}

fn part_of(
    site: PathSite,
    node: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    match node.kind {
        TreeNodeKind::Op => return op_part(site, node, scope),
        TreeNodeKind::Scope => return scope_part(node, nodes, scope),
        TreeNodeKind::Surface
        | TreeNodeKind::Collection
        | TreeNodeKind::Single
        | TreeNodeKind::Route
        | TreeNodeKind::Relay => {}
    }

    if let Some(own) = tree_nodes_text(node, "path") {
        return Ok(written_part(site, node, own, scope));
    }

    Ok(TreeNodesPathPart {
        text: segment_of_name(&node.name, site.path_case).map_err(|error| {
            InternalError::new(format!(
                "the name {} has no path segment: {error}",
                node.name
            ))
        })?,
        origin: node.origin.clone(),
        written: false,
    })
}

fn scope_part(
    node: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    let id_param = match node.parent {
        Some(parent) if node.name == MEMBER_SCOPE => {
            tree_nodes_id_param(nodes.get(parent)?, scope.context.raw.merged.get("schemas"))
        }
        _ => None,
    };

    Ok(TreeNodesPathPart {
        text: id_param.map_or_else(String::new, |param| format!("{{{param}}}")),
        origin: node.origin.clone(),
        written: false,
    })
}

/// The path of a route or an `ops` entry; a relay route's path is copied from the operation it relays.
pub(crate) fn tree_nodes_path(
    node: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
    prefixes: &TreeNodesSurfacePrefixes,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPath, PassError> {
    let site = PathSite {
        path_case: path_case_of(*scope.context.conventions)?,
    };
    let mut parts: Vec<TreeNodesPathPart> = Vec::new();
    let mut surface = node;
    let mut at = Some(node);

    while let Some(current) = at {
        match current.parent {
            None => surface = current,
            Some(_) => parts.insert(0, part_of(site, current, nodes, scope)?),
        }

        at = current.parent.map(|parent| nodes.get(parent)).transpose()?;
    }

    let Some(prefix) = prefixes.get(&surface.name) else {
        return Err(InternalError::new(format!(
            "the surface {} has no resolved prefix",
            surface.name
        ))
        .into());
    };
    let texts: Vec<&str> = parts
        .iter()
        .map(|part| part.text.as_str())
        .filter(|text| !text.is_empty())
        .collect();
    let mut segments: Vec<&str> = vec![prefix];

    segments.extend(texts);

    let joined = segments.join("/");

    Ok(TreeNodesPath {
        full: if joined.is_empty() {
            "/".to_owned()
        } else {
            joined
        },
        prefix: prefix.clone(),
        parts,
    })
}

fn written_part(
    _site: PathSite,
    node: &TreeNode<'_>,
    text: &str,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> TreeNodesPathPart {
    let origin = scope
        .context
        .origin(&format!("{}/path", node.pointer))
        .unwrap_or_else(|| node.origin.clone());

    TreeNodesPathPart {
        text: text.to_owned(),
        origin,
        written: true,
    }
}

fn op_part(
    site: PathSite,
    node: &TreeNode<'_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesPathPart, PassError> {
    if let Some(own) = tree_nodes_text(node, "path") {
        return Ok(written_part(site, node, own, scope));
    }

    let Some(op) = tree_nodes_op_shorthand(node) else {
        return Err(InternalError::new(format!(
            "the op at {} is no op the grammar admits",
            node.pointer
        ))
        .into());
    };
    let key = format!("ops.{}.path", op.as_str());
    let reading = scope.context.conventions.get(&key)?;

    match reading {
        Some(reading) => match reading.value {
            JsonValue::String(text) => Ok(TreeNodesPathPart {
                text: text.clone(),
                origin: reading.origin.unwrap_or_else(|| node.origin.clone()),
                written: true,
            }),
            _ => Err(InternalError::new(format!("conventions.{key} resolves to no path")).into()),
        },
        None => Err(InternalError::new(format!("conventions.{key} resolves to no path")).into()),
    }
}
