//! The route's `filteredBy` right.

use seampact_pipeline::{PassError, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::read::access_rights_string;
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

const FILTERED_BY_FIX: &str = "declare the right in 'rights', or name a declared one";

/// The route's `filteredBy` right, `None` when not written or refused.
///
/// # Errors
///
/// An internal error for a route whose node is not in the tree.
pub(crate) fn access_rights_filtered_by(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    route: &AccessRightsRoute,
) -> Result<Option<String>, PassError> {
    let node = context.nodes.get(route.node)?;
    let Some(right) = access_rights_string(Some(node.settings), "filteredBy") else {
        return Ok(None);
    };

    if catalogues.rights.contains_key(right) {
        return Ok(Some(right.to_owned()));
    }

    if !catalogues.declared.rights.contains(right) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::FilteredBy,
            message: format!(
                "route '{}' is filtered by right '{right}', which the rights catalogue does not declare",
                route.id
            ),
            fix: FILTERED_BY_FIX.to_owned(),
            pointer: pointer_below(&node.pointer, &["filteredBy"]),
            distinct_by: None,
            related: Vec::new(),
        });
    }

    Ok(None)
}
