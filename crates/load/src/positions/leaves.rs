//! Every schema node a node stands for once references and combinators are opened.

use std::collections::HashMap;

use indexmap::IndexSet;

use super::condition::{Container, MapView, holds};
use super::schema_files::SchemaFiles;
use super::schema_node::SchemaNode;

/// The branches a mapping's keys decide while its leaves are collected.
pub(super) struct Refinement<'view> {
    /// What the mapping says about itself.
    view: &'view dyn MapView,
    /// What each `if` met decided, in the order met, so equal choices can share one position.
    pub(super) trace: Vec<Option<bool>>,
    /// The `if` nodes the keys decided, with the branch taken.
    pub(super) choices: HashMap<SchemaNode, bool>,
}

impl<'view> Refinement<'view> {
    /// A refinement by `view`, with nothing decided yet.
    pub(super) fn new(view: &'view dyn MapView) -> Self {
        Self {
            view,
            trace: Vec::new(),
            choices: HashMap::new(),
        }
    }
}

/// Every node `node` stands for once references and combinators are opened, in the order met.
///
/// With a refinement, a `then` or `else` the mapping's keys rule out is left closed, and each
/// choice made is recorded in it.
pub(super) fn leaves(
    files: &SchemaFiles,
    node: &SchemaNode,
    out: &mut IndexSet<SchemaNode>,
    mut refinement: Option<&mut Refinement<'_>>,
) {
    if !out.insert(node.clone()) {
        return;
    }

    if let Some(target) = files.referenced(node) {
        leaves(files, &target, out, refinement.as_deref_mut());
    }

    for key in ["allOf", "anyOf", "oneOf"] {
        for member in node.subschemas(key) {
            leaves(files, &member, out, refinement.as_deref_mut());
        }
    }

    let chosen = choice_of(node, refinement.as_deref_mut());

    if chosen != Some(false) {
        for member in node.subschemas("then") {
            leaves(files, &member, out, refinement.as_deref_mut());
        }
    }

    if chosen != Some(true) {
        for member in node.subschemas("else") {
            leaves(files, &member, out, refinement.as_deref_mut());
        }
    }
}

/// The branch the mapping's keys choose at the `if` of `node`, recorded in the refinement.
fn choice_of(node: &SchemaNode, refinement: Option<&mut Refinement<'_>>) -> Option<bool> {
    let refinement = refinement?;
    let condition = node
        .member("if")
        .filter(|value| value.as_node().is_some())?;
    let chosen = holds(condition, Container::Object, Some(refinement.view));

    refinement.trace.push(chosen);

    if let Some(decided) = chosen {
        refinement.choices.insert(node.clone(), decided);
    }

    chosen
}
