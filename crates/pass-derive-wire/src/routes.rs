//! Each operation of the draft with the tree node `tree.nodes` wrote it from, matched by the origin
//! pointer, which `tree.nodes` sets to the node's own pointer (route, relay route or `ops` entry);
//! and the scope every writer of the half shares.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    ApiWire, Int64Wire, KnownAccessRef, OperationId, Origin, OutputEnumForm, Response, UrlForm,
};
use seampact_pipeline::{
    DeriveWireOperation, DeriveWireOutput, DraftIr, DraftOperation, HalfContext, OperationIndex,
    TreeNode, TreeNodeId, TreeSchemaService, place_derived_responses,
};

use crate::report::{
    DeriveWireProblem, DeriveWireRelated, DeriveWireReporter, derive_wire_reporter,
};

/// An operation with its node and what every writer of the half reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveWireRoute {
    pub(crate) operation: OperationIndex,
    pub(crate) id: OperationId,
    pub(crate) node: TreeNodeId,
}

/// A fault of an inherited setting, with every route it reaches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveWireSettingFault {
    pub(crate) problem: DeriveWireProblem,
    pub(crate) routes: Vec<DeriveWireRelated>,
}

/// What the writers of the half share: the draft they read, the context they report through, the
/// service, and the output they accumulate.
///
/// The TypeScript half writes the draft it reads back; here every member the half reads back
/// after writing it has a merged view (`responses_of`), and writes go only through the output.
pub(crate) struct DeriveWireScope<'draft, 'half, 'run> {
    pub(crate) draft: &'draft DraftIr,
    pub(crate) context: &'half mut HalfContext<'run>,
    pub(crate) schemas: &'half dyn TreeSchemaService,
    pub(crate) output: DeriveWireOutput,
    /// The collisions reported once for every route they reach, by derivation, place, name and
    /// location. Lookup only.
    pub(crate) reported_collisions: HashSet<String>,
    /// The faults of an inherited setting, one per rule and authored origin, reported after the
    /// last route; insertion order kept.
    pub(crate) setting_faults: IndexMap<String, DeriveWireSettingFault>,
}

impl<'draft, 'half, 'run> DeriveWireScope<'draft, 'half, 'run> {
    /// The scope of one run: one output entry per draft operation.
    pub(crate) fn new(
        draft: &'draft DraftIr,
        context: &'half mut HalfContext<'run>,
        schemas: &'half dyn TreeSchemaService,
    ) -> Self {
        // `api.wire` is overwritten before any writer reads it: `deriveWireApiWire` runs first.
        let api_wire = ApiWire {
            int64: Int64Wire::String,
            output_enums: OutputEnumForm::Enum,
            urls: UrlForm::Relative,
        };
        let operations = draft
            .operation_indices()
            .map(|_| DeriveWireOperation::default())
            .collect();

        Self {
            draft,
            context,
            schemas,
            output: DeriveWireOutput {
                api_wire,
                operations,
            },
            reported_collisions: HashSet::new(),
            setting_faults: IndexMap::new(),
        }
    }

    /// The reporter over the scope's context.
    pub(crate) fn reporter(&mut self) -> DeriveWireReporter<'_, 'run> {
        derive_wire_reporter(&mut *self.context)
    }

    /// Hands the accumulated output to the dispatch.
    pub(crate) fn into_output(self) -> DeriveWireOutput {
        self.output
    }

    /// The draft operation at `operation`.
    pub(crate) fn operation_of(
        &self,
        operation: OperationIndex,
    ) -> Result<&'draft DraftOperation, InternalError> {
        let draft = self.draft;

        draft.operations.get(operation.position()).ok_or_else(|| {
            InternalError::new(format!(
                "derive.wire read operation {}, which the draft lacks",
                operation.position()
            ))
        })
    }

    /// What the half accumulates for the operation.
    pub(crate) fn output_of(
        &mut self,
        operation: OperationIndex,
    ) -> Result<&mut DeriveWireOperation, InternalError> {
        self.output
            .operations
            .get_mut(operation.position())
            .ok_or_else(|| {
                InternalError::new(format!(
                    "derive.wire wrote operation {}, which the draft lacks",
                    operation.position()
                ))
            })
    }

    /// The tree node of a route; it borrows the run, not the scope.
    pub(crate) fn node_of(
        &self,
        route: &DeriveWireRoute,
    ) -> Result<&'run TreeNode<'run>, InternalError> {
        let inherited = self.context.inherited;

        inherited.nodes().get(route.node)
    }

    /// The responses of the operation as the half has them so far: the draft's, then the ones the
    /// half appended, each with the headers the half added. Built owned, since a response gains
    /// headers from the output.
    pub(crate) fn responses_of(
        &self,
        operation: OperationIndex,
    ) -> Result<Vec<Response>, InternalError> {
        let draft_operation = self.operation_of(operation)?;
        let written = self
            .output
            .operations
            .get(operation.position())
            .ok_or_else(|| {
                InternalError::new(format!(
                    "derive.wire read operation {}, which its output lacks",
                    operation.position()
                ))
            })?;
        let mut responses = draft_operation.responses.clone().unwrap_or_default();

        place_derived_responses(&mut responses, written.responses.iter().cloned())?;

        for addition in &written.response_headers {
            let total = responses.len();
            let response = responses.get_mut(addition.response).ok_or_else(|| {
                InternalError::new(format!(
                    "derive.wire added headers to response {} of {total}",
                    addition.response
                ))
            })?;

            response.headers.extend(addition.headers.iter().cloned());
        }

        Ok(responses)
    }
}

/// Every operation of the draft with its tree node, in draft order.
///
/// # Errors
///
/// An internal error for an operation that has no id or whose origin is no tree node.
pub(crate) fn derive_wire_routes(
    draft: &DraftIr,
    context: &HalfContext<'_>,
) -> Result<Vec<DeriveWireRoute>, InternalError> {
    let nodes = context.inherited.nodes();
    let node_by_pointer: HashMap<&str, TreeNodeId> = nodes
        .iter()
        .map(|(id, node)| (node.pointer.as_str(), id))
        .collect();
    let mut routes = Vec::new();

    for (position, operation) in draft.operation_indices().zip(&draft.operations) {
        let pointer = operation
            .origin
            .as_ref()
            .map(|origin| origin.pointer.as_str());
        let node = pointer.and_then(|pointer| node_by_pointer.get(pointer).copied());

        let (Some(id), Some(node)) = (operation.id.clone(), node) else {
            return Err(InternalError::new(format!(
                "tree.nodes wrote an operation ({}) whose origin {} is no tree node",
                operation.id.as_ref().map_or("no id", |id| id.as_str()),
                pointer.unwrap_or("(none)")
            )));
        };

        routes.push(DeriveWireRoute {
            operation: position,
            id,
            node,
        });
    }

    Ok(routes)
}

/// The access `access.identity` wrote on the operation, a relay route's included; none is an
/// internal error.
///
/// # Errors
///
/// An internal error for an operation without access, or with an access of a kind this compiler
/// does not know.
pub(crate) fn derive_wire_access_of<'draft>(
    scope: &DeriveWireScope<'draft, '_, '_>,
    route: &DeriveWireRoute,
) -> Result<KnownAccessRef<'draft>, InternalError> {
    let operation = scope.operation_of(route.operation)?;
    let Some(access) = &operation.access else {
        return Err(InternalError::new(format!(
            "access.identity wrote no access on operation '{}'",
            route.id
        )));
    };

    Ok(KnownAccessRef::try_from(access)?)
}

/// The origin of a pointer of the merged raw tree the half read; one without an origin is an
/// internal error.
///
/// # Errors
///
/// An internal error when the side table has no origin at `pointer`.
pub(crate) fn derive_wire_origin_at(
    scope: &DeriveWireScope<'_, '_, '_>,
    pointer: &str,
) -> Result<Origin, InternalError> {
    scope
        .context
        .origin(pointer)
        .ok_or_else(|| InternalError::new(format!("{pointer} has no origin in the side table")))
}
