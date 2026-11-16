//! The public operation a relay route relays, as its own api derived it: the derived draft of a
//! workspace api (`relayed`) or the IR of an import (`imported`). tree.nodes already found it and
//! refused an import holding what this compiler does not know, so a missing or open one is an
//! internal error. A relay route has no resource of its own, so what its version derives from (the
//! version parameter, the `ETag` of a versioned item) is read here.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivedFrom, IrClosedCheck, Operation, Param, Response, check_ir_closed_declaration,
};
use seampact_pass_tree_shared::{TREE_NODES_OPERATION_KIND, tree_nodes_relay_origin};
use seampact_pipeline::DraftOperation;

use crate::params::DeriveWireParamPlace;
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
/// An internal error for an operation no workspace api or import holds closed.
pub(crate) fn derive_wire_relayed_of<'run>(
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, 'run>,
) -> Result<Option<DeriveWireRelayed<'run>>, InternalError> {
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

    let imported = scope.context.imported_ir(api).and_then(|imported| {
        imported
            .contract()
            .operations
            .iter()
            .enumerate()
            .find(|(_, candidate)| {
                candidate.kind == TREE_NODES_OPERATION_KIND && candidate.id == *id
            })
            .map(|(index, operation)| (imported, index, operation))
    });
    let closed = imported
        .map(|(imported, index, operation)| {
            let pointer = format!("/operations/{index}");

            check_ir_closed_declaration(operation, imported.document(), &pointer)
        })
        .transpose()
        .map_err(|error| InternalError::new(error.to_string()))?;

    if let Some(IrClosedCheck::Closed(operation)) = closed {
        return Ok(Some(DeriveWireRelayed {
            api: api.to_owned(),
            operation: DeriveWireRelayedOperation::Imported(operation),
        }));
    }

    Err(InternalError::new(format!(
        "operation '{}' relays {api}.{id}, which tree.nodes found but is no closed operation of {api}",
        route.id
    )))
}

/// A copy of a derivation of the public operation, its origins in that api named by `api`.
pub(crate) fn derive_wire_relayed_derived_from(
    derived_from: &DerivedFrom,
    api: &str,
) -> DerivedFrom {
    DerivedFrom {
        derivation: derived_from.derivation.clone(),
        from: derived_from
            .from
            .iter()
            .map(|origin| tree_nodes_relay_origin(origin, api))
            .collect(),
    }
}

impl<'run> DeriveWireRelayedOperation<'run> {
    /// The derivation of the operation's `concurrency`, when it has one.
    pub(crate) fn concurrency_derived_from(self) -> Option<&'run DerivedFrom> {
        match self {
            Self::Draft(operation) => operation
                .concurrency
                .as_ref()
                .and_then(|concurrency| concurrency.derived_from.as_ref()),
            Self::Imported(operation) => operation
                .concurrency
                .as_ref()
                .map(|concurrency| &concurrency.derived_from),
        }
    }

    /// The parameter of the `place` list named `name`.
    pub(crate) fn param_named(
        self,
        place: DeriveWireParamPlace,
        name: &str,
    ) -> Option<&'run Param> {
        let params = match self {
            Self::Draft(operation) => operation.params.as_ref(),
            Self::Imported(operation) => Some(&operation.params),
        }?;
        let list = match place {
            DeriveWireParamPlace::Query => &params.query,
            DeriveWireParamPlace::Header => &params.header,
        };

        list.iter().find(|candidate| candidate.name == name)
    }

    /// The operation's responses.
    pub(crate) fn responses(self) -> &'run [Response] {
        match self {
            Self::Draft(operation) => operation.responses.as_deref().unwrap_or_default(),
            Self::Imported(operation) => &operation.responses,
        }
    }
}
