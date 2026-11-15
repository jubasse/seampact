//! The public operation a relay route relays, as its own api derived it: the derived draft of a
//! workspace api (`relayed`) or the IR of an import (`imported`). tree.nodes already found it and
//! refused an import holding what this compiler does not know, so a missing or open one is an
//! internal error. A relay route has no resource of its own, so what its version derives from (the
//! version parameter, the `ETag` of a versioned item) is read here.

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivedFrom, Operation};
use seampact_pass_tree_shared::TREE_NODES_OPERATION_KIND;
use seampact_pipeline::{DraftOperation, PassError};

use crate::not_ported::not_ported_yet;
use crate::routes::{DeriveWireRoute, DeriveWireScope};

/// The public operation of a relay route: from a workspace api's draft, or an import's closed IR.
#[derive(Debug, Clone, Copy)]
pub(crate) enum DeriveWireRelayedOperation<'run> {
    Draft(&'run DraftOperation),
    Imported(&'run Operation),
}

/// The public operation of a relay route, with the api that declares it.
#[derive(Debug, Clone)]
pub(crate) struct DeriveWireRelayed<'run> {
    pub(crate) api: String,
    pub(crate) operation: DeriveWireRelayedOperation<'run>,
}

/// The public operation the route relays, or `None` on a route that relays nothing.
///
/// # Errors
///
/// An internal error for an operation no workspace api or import holds, and
/// [`PassError::NotPortedYet`] for an imported one, whose closed check is not ported.
pub(crate) fn derive_wire_relayed_of<'run>(
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, 'run>,
) -> Result<Option<DeriveWireRelayed<'run>>, PassError> {
    let Some(relays) = &scope.operation_of(route.operation)?.relays else {
        return Ok(None);
    };
    let api = relays.api.as_str();
    let id = &relays.id;
    let from_draft = scope.context.relayed(api).and_then(|draft| {
        draft.operations.iter().find(|candidate| {
            candidate.kind.as_ref() == Some(&TREE_NODES_OPERATION_KIND)
                && candidate.id.as_ref() == Some(id)
        })
    });

    if let Some(operation) = from_draft {
        return Ok(Some(DeriveWireRelayed {
            api: api.to_owned(),
            operation: DeriveWireRelayedOperation::Draft(operation),
        }));
    }

    let imported = scope.context.imported(api).and_then(|contract| {
        contract
            .operations
            .iter()
            .find(|candidate| candidate.kind == TREE_NODES_OPERATION_KIND && candidate.id == *id)
    });

    if imported.is_none() {
        return Err(InternalError::new(format!(
            "operation '{}' relays {api}.{id}, which tree.nodes found but is no closed operation of {api}",
            route.id
        ))
        .into());
    }

    // The closed check of an imported operation is the foreign `checkIrClosedDeclaration`.
    Err(not_ported_yet("checkIrClosedDeclaration"))
}

/// A copy of a derivation of the public operation, its origins in that api named by `api`.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub(crate) fn derive_wire_relayed_derived_from(
    _derived_from: &DerivedFrom,
    _api: &str,
) -> Result<DerivedFrom, PassError> {
    Err(not_ported_yet("deriveWireRelayedDerivedFrom"))
}
