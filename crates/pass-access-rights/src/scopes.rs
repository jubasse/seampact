//! The scopes a route enters, in resolution order (ADR 0002 section 9).

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_ir::{OperationScope, ScopeId};
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{InheritedEntry, OrderedSetting, PassError, TreeNodeId, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::schema_use::AccessRightsContext;
use crate::source::access_rights_value_source;

/// One `scopes` entry written on a node, with the scope it names and its pointer.
#[derive(Debug, Clone)]
pub(crate) struct ScopeUse<'run> {
    pub(crate) scope: String,
    pub(crate) entry: InheritedEntry<'run>,
    pub(crate) pointer: String,
}

/// The resolved scopes of the route at `node`, each with its source and the origin of the node
/// that entered it.
///
/// # Errors
///
/// An internal error for a scope source outside the grammar's forms, and what its callees fail
/// with.
pub(crate) fn access_rights_operation_scopes(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    node: TreeNodeId,
) -> Result<Vec<OperationScope>, PassError> {
    let mut resolved: Vec<ScopeUse<'_>> = Vec::new();
    let groups = uses_by_node(context, reporter, catalogues, node)?;
    let entered_names: HashSet<String> = groups
        .iter()
        .flatten()
        .map(|scope_use| scope_use.scope.clone())
        .collect();

    for group in groups {
        for scope_use in resolution_order(group, catalogues)? {
            if check_entered_once(reporter, catalogues, &resolved, &entered_names, &scope_use)? {
                resolved.push(scope_use);
            }
        }
    }

    let mut scopes = Vec::with_capacity(resolved.len());

    for scope_use in resolved {
        let source = match scope_use.entry.value {
            JsonValue::String(text) => access_rights_value_source(text)?,
            _ => None,
        };
        let Some(source) = source else {
            return Err(InternalError::new(format!(
                "the scope source {} at {} is outside the grammar's forms",
                stringify_json(scope_use.entry.value),
                scope_use.pointer
            ))
            .into());
        };

        scopes.push(OperationScope {
            scope: ScopeId::new(scope_use.scope),
            source,
            origin: scope_use.entry.origin,
        });
    }

    Ok(scopes)
}

// The scope entries from the root down, grouped by the node that wrote them; an undeclared scope
// is reported, a declared one that was refused is left out silently (its declaration already has
// an error).
pub(crate) fn uses_by_node<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    node: TreeNodeId,
) -> Result<Vec<Vec<ScopeUse<'run>>>, InternalError> {
    let inherited = context.context.inherited;
    let mut groups: Vec<Vec<ScopeUse<'run>>> = Vec::new();
    let mut current: Option<TreeNodeId> = None;

    for entry in inherited
        .ordered(node, OrderedSetting::Scopes)?
        .unwrap_or_default()
    {
        let entry_node = context.nodes.get(entry.node)?;
        let Some(scope) = entry.key.clone() else {
            return Err(InternalError::new(format!(
                "a 'scopes' entry of {} is read without its scope name",
                entry_node.pointer
            )));
        };
        let pointer = pointer_below(&entry_node.pointer, &["scopes", &scope]);

        if !catalogues.declared.scopes.contains(&scope) {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::ScopeUnknown,
                message: format!(
                    "scope '{scope}' is entered here, but the scopes catalogue does not declare it"
                ),
                fix: "declare the scope in 'scopes', or enter a declared one".to_owned(),
                pointer,
                distinct_by: None,
                related: Vec::new(),
            });

            continue;
        }

        if !catalogues.scopes.contains_key(scope.as_str()) {
            continue;
        }

        if current != Some(entry.node) {
            groups.push(Vec::new());
            current = Some(entry.node);
        }

        if let Some(group) = groups.last_mut() {
            group.push(ScopeUse {
                scope,
                entry,
                pointer,
            });
        }
    }

    Ok(groups)
}

pub(crate) fn access_rights_scope_ancestors(
    _catalogues: &AccessRightsCatalogues,
    _scope: &str,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("accessRightsScopeAncestors"))
}

pub(crate) fn resolution_order<'run>(
    _group: Vec<ScopeUse<'run>>,
    _catalogues: &AccessRightsCatalogues,
) -> Result<Vec<ScopeUse<'run>>, PassError> {
    Err(not_ported_yet("resolutionOrder"))
}

pub(crate) fn check_entered_once(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _resolved: &[ScopeUse<'_>],
    _entered_names: &HashSet<String>,
    _use: &ScopeUse<'_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkEnteredOnce"))
}
