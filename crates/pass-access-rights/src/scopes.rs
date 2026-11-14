//! The scopes a route enters, in resolution order (ADR 0002 section 9).

use std::collections::HashSet;

use seampact_ir::OperationScope;
use seampact_pipeline::{InheritedEntry, PassError, TreeNodeId};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::schema_use::AccessRightsContext;

/// One `scopes` entry written on a node, with the scope it names and its pointer.
#[derive(Debug, Clone)]
pub(crate) struct ScopeUse<'run> {
    pub(crate) scope: String,
    pub(crate) entry: InheritedEntry<'run>,
    pub(crate) pointer: String,
}

pub(crate) fn access_rights_operation_scopes(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _node: TreeNodeId,
) -> Result<Vec<OperationScope>, PassError> {
    Err(not_ported_yet("accessRightsOperationScopes"))
}

pub(crate) fn uses_by_node<'run>(
    _context: &AccessRightsContext<'_, '_, 'run>,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _node: TreeNodeId,
) -> Result<Vec<Vec<ScopeUse<'run>>>, PassError> {
    Err(not_ported_yet("usesByNode"))
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
