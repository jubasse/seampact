//! `input.bodyLimitBytes` (`body.limit`, ADR 0006 section 5) on every input, a proof-only one
//! included: the nearest `bodyLimit` of the route, else `conventions.batch.bodyLimit` for a batch
//! op, else `conventions.bodyLimit` (1 MiB). A limit that does not parse is reported by tree.nodes,
//! so the compile already fails and the input is left without one.

use seampact_pass_tree_nodes::{TreeNodesBodyLimitContext, tree_nodes_body_limit};
use seampact_pipeline::PassError;

use crate::routes::{DeriveWireRoute, DeriveWireScope};

/// Writes the body limit of the route's input.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] while `tree.nodes` has not ported its body limit.
pub(crate) fn derive_wire_body_limit(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if scope.operation_of(route.operation)?.input.is_none() {
        return Ok(());
    }

    let node = scope.node_of(route)?;
    let context = TreeNodesBodyLimitContext {
        inherited: scope.context.inherited,
        conventions: scope.context.conventions,
    };
    let limit = tree_nodes_body_limit(node, &context)?;

    if let Some(limit) = limit {
        scope.output_of(route.operation)?.body_limit_bytes = Some(limit.bytes);
    }

    Ok(())
}
