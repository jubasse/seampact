//! The scopes a route enters, in resolution order (ADR 0002 section 9).

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_ir::{OperationScope, ScopeId};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{InheritedEntry, OrderedSetting, PassError, TreeNodeId, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
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
        for scope_use in resolution_order(group, catalogues) {
            if check_entered_once(reporter, catalogues, &resolved, &entered_names, &scope_use) {
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

/// The scopes `scope` is within, nearest first. The catalogue refused every cycle, so the chain
/// ends.
pub(crate) fn access_rights_scope_ancestors(
    catalogues: &AccessRightsCatalogues,
    scope: &str,
) -> Vec<String> {
    let mut ancestors = Vec::new();
    let mut parent = catalogues
        .scopes
        .get(scope)
        .and_then(|declared| declared.within.as_ref());

    while let Some(name) = parent {
        ancestors.push(name.as_str().to_owned());
        parent = catalogues
            .scopes
            .get(name.as_str())
            .and_then(|declared| declared.within.as_ref());
    }

    ancestors
}

// One node's scopes: each after the ones it is within, then by name.
pub(crate) fn resolution_order<'run>(
    group: Vec<ScopeUse<'run>>,
    catalogues: &AccessRightsCatalogues,
) -> Vec<ScopeUse<'run>> {
    let mut remaining = group;
    let mut ordered = Vec::with_capacity(remaining.len());

    remaining.sort_by(|left, right| cmp_utf16(&left.scope, &right.scope));

    while !remaining.is_empty() {
        let names: HashSet<&str> = remaining.iter().map(|used| used.scope.as_str()).collect();
        let index = remaining
            .iter()
            .position(|used| {
                access_rights_scope_ancestors(catalogues, &used.scope)
                    .iter()
                    .all(|parent| !names.contains(parent.as_str()))
            })
            .unwrap_or(0);

        ordered.push(remaining.remove(index));
    }

    ordered
}

// A scope entered twice, below one of its own child scopes, or without its parent entered is an
// error; true when `use` may be resolved.
pub(crate) fn check_entered_once(
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    resolved: &[ScopeUse<'_>],
    entered_names: &HashSet<String>,
    use_of: &ScopeUse<'_>,
) -> bool {
    if let Some(twice) = resolved.iter().find(|earlier| earlier.scope == use_of.scope) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ScopeTwice,
            message: format!(
                "scope '{}' is entered twice on the routes below this node",
                use_of.scope
            ),
            fix: "enter the scope once, on the highest node that needs it".to_owned(),
            pointer: use_of.pointer.clone(),
            distinct_by: None,
            related: vec![AccessRightsRelated {
                pointer: twice.pointer.clone(),
                message: "first entered here".to_owned(),
            }],
        });

        return false;
    }

    let child = resolved.iter().find(|earlier| {
        access_rights_scope_ancestors(catalogues, &earlier.scope).contains(&use_of.scope)
    });

    if let Some(child) = child {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ScopeNesting,
            message: format!(
                "scope '{}' is entered below '{}', which is within it",
                use_of.scope, child.scope
            ),
            fix: format!(
                "enter '{}' on '{}''s node or above it",
                use_of.scope, child.scope
            ),
            pointer: use_of.pointer.clone(),
            distinct_by: None,
            related: vec![AccessRightsRelated {
                pointer: child.pointer.clone(),
                message: format!("'{}' is entered here", child.scope),
            }],
        });

        return false;
    }

    let parent = catalogues
        .scopes
        .get(use_of.scope.as_str())
        .and_then(|declared| declared.within.as_ref());

    // A parent entered below this scope is reported at its own entry as a scope entered below its
    // child.
    if let Some(parent) = parent
        && !entered_names.contains(parent.as_str())
    {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ScopeNesting,
            message: format!(
                "scope '{}' is within '{parent}', which is not entered at this node or an ancestor",
                use_of.scope
            ),
            fix: format!("enter '{parent}' at this node or an ancestor"),
            pointer: use_of.pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return false;
    }

    true
}
