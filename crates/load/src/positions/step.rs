//! What a schema node says about one child: a key of a mapping or an index of a list.

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::InternalError;

use super::condition::{Container, holds};
use super::schema_files::SchemaFiles;
use super::schema_node::{SchemaNode, SchemaValue};
use super::types::{TypeName, types_of};

/// How a child is reached from a position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    /// A key of a mapping.
    Key,
    /// An index of a list.
    Index,
}

impl StepKind {
    fn type_name(self) -> TypeName {
        match self {
            Self::Key => TypeName::Object,
            Self::Index => TypeName::Array,
        }
    }

    fn container(self) -> Container {
        match self {
            Self::Key => Container::Object,
            Self::Index => Container::Array,
        }
    }
}

/// What a node says about one child: a schema node, no constraint at all, or no child possible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Step {
    Node(SchemaNode),
    Free,
    NoChild,
}

/// Constraints that all hold: a child impossible in one is impossible; no constraint adds nothing.
fn all_of_steps(parts: Vec<Step>) -> Step {
    if parts.contains(&Step::NoChild) {
        return Step::NoChild;
    }

    let nodes: Vec<SchemaNode> = parts
        .into_iter()
        .filter_map(|part| match part {
            Step::Node(node) => Some(node),
            _ => None,
        })
        .collect();

    if nodes.is_empty() {
        return Step::Free;
    }

    join_nodes("allOf", nodes)
}

/// Alternatives: an impossible one is dropped; one that constrains nothing frees the child.
fn any_of_steps(parts: Vec<Step>) -> Step {
    let live: Vec<Step> = parts
        .into_iter()
        .filter(|part| *part != Step::NoChild)
        .collect();

    if live.is_empty() {
        return Step::NoChild;
    }

    if live.contains(&Step::Free) {
        return Step::Free;
    }

    let nodes = live
        .into_iter()
        .filter_map(|part| match part {
            Step::Node(node) => Some(node),
            _ => None,
        })
        .collect();

    join_nodes("anyOf", nodes)
}

/// One node as it is, several as a node combining them under `keyword`.
fn join_nodes(keyword: &str, nodes: Vec<SchemaNode>) -> Step {
    match <[SchemaNode; 1]>::try_from(nodes) {
        Ok([only]) => Step::Node(only),
        Err(several) => Step::Node(SchemaNode::with_member(
            keyword,
            SchemaValue::Array(several.into_iter().map(SchemaValue::Object).collect()),
        )),
    }
}

/// The node's own keywords for the child (`ownStep`).
fn own_step(
    files: &SchemaFiles,
    node: &SchemaNode,
    segment: &str,
    kind: StepKind,
) -> Result<Step, InternalError> {
    // `items` is the one form the grammar writes for lists.
    if kind == StepKind::Index {
        return Ok(step_of(node.member("items")));
    }

    let mut parts = Vec::new();

    if let Some(property) = node
        .node_member("properties")
        .and_then(|properties| properties.member(segment))
    {
        parts.push(step_of(Some(property)));
    }

    if let Some(patterns) = node.node_member("patternProperties") {
        for (pattern, schema) in patterns.members() {
            if files.matches_pattern(pattern, segment)? {
                parts.push(step_of(Some(schema)));
            }
        }
    }

    if parts.is_empty() {
        return Ok(step_of(node.member("additionalProperties")));
    }

    Ok(all_of_steps(parts))
}

/// What a schema value says about the child it holds: `false` and a conflict marker
/// (`not: {}`, the key may not appear in this case) forbid it, a node types it, any other value,
/// or none, leaves it free.
fn step_of(value: Option<&SchemaValue>) -> Step {
    match value {
        Some(SchemaValue::Bool(false)) => Step::NoChild,
        Some(SchemaValue::Object(node)) if node.is_conflict() => Step::NoChild,
        Some(SchemaValue::Object(node)) => Step::Node(node.clone()),
        _ => Step::Free,
    }
}

/// What `node` says about the child `segment`, by the branches `choices` took.
///
/// # Errors
///
/// An [`InternalError`] for a `patternProperties` pattern the load did not compile.
pub(super) fn step_node(
    files: &SchemaFiles,
    node: &SchemaNode,
    segment: &str,
    kind: StepKind,
    choices: Option<&HashMap<SchemaNode, bool>>,
) -> Result<Step, InternalError> {
    step_unless_stepping(
        files,
        node,
        &StepRequest {
            segment,
            kind,
            choices,
        },
        &mut HashSet::new(),
    )
}

/// The child being looked for, and the branches already chosen.
struct StepRequest<'request> {
    segment: &'request str,
    kind: StepKind,
    choices: Option<&'request HashMap<SchemaNode, bool>>,
}

/// [`step_node`] that answers `Free` for a node it is already stepping through: a reference
/// cycle constrains nothing more on its second visit.
fn step_unless_stepping(
    files: &SchemaFiles,
    node: &SchemaNode,
    request: &StepRequest<'_>,
    stepping: &mut HashSet<SchemaNode>,
) -> Result<Step, InternalError> {
    if files.is_included_node(node) {
        return Ok(Step::NoChild);
    }

    let types = types_of(files, node);

    if types.is_some_and(|types| !types.contains(&request.kind.type_name())) {
        return Ok(Step::NoChild);
    }

    if !stepping.insert(node.clone()) {
        return Ok(Step::Free);
    }

    let step = step_through_combinators(files, node, request, stepping);

    stepping.remove(node);

    step
}

/// The node's own step joined with those of its `$ref`, `allOf`, `anyOf`, `oneOf` and `if`.
fn step_through_combinators(
    files: &SchemaFiles,
    node: &SchemaNode,
    request: &StepRequest<'_>,
    stepping: &mut HashSet<SchemaNode>,
) -> Result<Step, InternalError> {
    let mut parts = vec![own_step(files, node, request.segment, request.kind)?];

    if let Some(target) = files.referenced(node) {
        parts.push(step_unless_stepping(files, &target, request, stepping)?);
    }

    for member in node.subschemas("allOf") {
        parts.push(step_unless_stepping(files, &member, request, stepping)?);
    }

    for key in ["anyOf", "oneOf"] {
        if node.member(key).is_some() {
            let alternatives = steps_of_members(files, node, key, request, stepping)?;

            parts.push(any_of_steps(alternatives));
        }
    }

    if let Some(condition) = node.member("if").filter(|value| value.as_node().is_some()) {
        let chosen = request
            .choices
            .and_then(|choices| choices.get(node).copied())
            .or_else(|| holds(condition, request.kind.container(), None));
        let mut branches = Vec::new();

        if chosen != Some(false) {
            branches.push(branch_step(files, node, "then", request, stepping)?);
        }

        if chosen != Some(true) {
            branches.push(branch_step(files, node, "else", request, stepping)?);
        }

        parts.push(any_of_steps(branches));
    }

    Ok(all_of_steps(parts))
}

fn steps_of_members(
    files: &SchemaFiles,
    node: &SchemaNode,
    key: &str,
    request: &StepRequest<'_>,
    stepping: &mut HashSet<SchemaNode>,
) -> Result<Vec<Step>, InternalError> {
    node.subschemas(key)
        .iter()
        .map(|member| step_unless_stepping(files, member, request, stepping))
        .collect()
}

/// The step of a `then` or `else` branch; a missing branch constrains nothing.
fn branch_step(
    files: &SchemaFiles,
    node: &SchemaNode,
    key: &str,
    request: &StepRequest<'_>,
    stepping: &mut HashSet<SchemaNode>,
) -> Result<Step, InternalError> {
    match node.subschemas(key).into_iter().next() {
        Some(branch) => step_unless_stepping(files, &branch, request, stepping),
        None => Ok(Step::Free),
    }
}
