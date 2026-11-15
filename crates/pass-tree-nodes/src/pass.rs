//! The run of the half: its scope, which reads the draft and owns the output, and its entry.

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Conventions, FormatId, IrMap, Lint, PackRef, PagingId, PagingStyle, Service, ServiceId,
    WireFormat,
};
use seampact_pipeline::{
    ApiDeclaration, DraftIr, DraftOperation, HalfContext, PassError, TreeNodesOperation,
    TreeNodesOutput, TreeSchemaService, pipeline_tree_nodes,
};

use crate::api::tree_nodes_api;
use crate::collections::tree_nodes_check_id_properties;
use crate::formats::{tree_nodes_check_payloads, tree_nodes_formats};
use crate::limits::tree_nodes_check_body_limits;
use crate::not_ported::not_ported_yet;
use crate::operations::tree_nodes_operations;
use crate::pagings::tree_nodes_pagings;
use crate::relays::tree_nodes_join_relay_declarations;
use crate::settings::tree_nodes_api_settings;

/// The operation as the output declares it, from the draft `operationOf` builds.
fn declared_operation(_draft: DraftOperation) -> Result<TreeNodesOperation, PassError> {
    Err(not_ported_yet("operationOf"))
}

/// What the half writes, built up member by member: `api` is written first, so the output only
/// exists once it is.
#[derive(Debug, Default)]
pub(crate) struct TreeNodesAccumulator {
    pub(crate) conventions: Conventions,
    pub(crate) lint: Option<Lint>,
    pub(crate) packs: Vec<PackRef>,
    pub(crate) formats: IrMap<FormatId, WireFormat>,
    pub(crate) pagings: IrMap<PagingId, PagingStyle>,
    pub(crate) services: IrMap<ServiceId, Service>,
    pub(crate) api: Option<ApiDeclaration>,
    pub(crate) operations: Vec<DraftOperation>,
}

impl TreeNodesAccumulator {
    /// The output, once the api and the lint are written.
    fn into_output(self) -> Result<TreeNodesOutput, PassError> {
        let (Some(api), Some(lint)) = (self.api, self.lint) else {
            return Err(InternalError::new(
                "tree.nodes ended without writing the api and the lint",
            )
            .into());
        };

        let operations = self
            .operations
            .into_iter()
            .map(declared_operation)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TreeNodesOutput {
            conventions: self.conventions,
            lint,
            packs: self.packs,
            formats: self.formats,
            pagings: self.pagings,
            services: self.services,
            api,
            operations,
        })
    }
}

/// What every function of the half reads and writes during one run.
///
/// `draft` is read only; every write goes to `output`, which the dispatch merges into the draft.
pub(crate) struct TreeNodesScope<'draft, 'half, 'run> {
    pub(crate) draft: &'draft DraftIr,
    pub(crate) context: &'half mut HalfContext<'run>,
    pub(crate) schemas: &'half dyn TreeSchemaService,
    pub(crate) output: TreeNodesAccumulator,
    /// The keys of the diagnostics `treeNodesReportOnce` already reported; looked up, never iterated.
    pub(crate) reported_once: HashSet<String>,
}

impl<'draft, 'half, 'run> TreeNodesScope<'draft, 'half, 'run> {
    fn new(
        draft: &'draft DraftIr,
        context: &'half mut HalfContext<'run>,
        schemas: &'half dyn TreeSchemaService,
    ) -> Self {
        Self {
            draft,
            context,
            schemas,
            output: TreeNodesAccumulator::default(),
            reported_once: HashSet::new(),
        }
    }
}

/// Runs `tree.nodes` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<TreeNodesOutput, PassError> {
    let nodes = pipeline_tree_nodes(context.raw)?;
    let mut scope = TreeNodesScope::new(draft, context, schemas);
    let prefixes = tree_nodes_api(&mut scope)?;

    tree_nodes_api_settings(&mut scope)?;
    tree_nodes_check_body_limits(&mut scope)?;
    let relay_declarations = tree_nodes_operations(&nodes, &prefixes, &mut scope)?;

    tree_nodes_check_id_properties(&mut scope)?;
    tree_nodes_formats(&mut scope)?;
    tree_nodes_pagings(&mut scope)?;
    tree_nodes_join_relay_declarations(&relay_declarations, &mut scope)?;
    tree_nodes_check_payloads(&mut scope)?;

    scope.output.into_output()
}
