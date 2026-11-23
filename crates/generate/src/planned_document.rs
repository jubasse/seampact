//! The OpenAPI documents an app plans, each with the IR it serves.

use seampact_cli_config::{
    ApiDocuments, CliProblem, LoadedAppConfig, OperationsFilter, PlannedAppDocument, Problems,
    TargetEntrySettings, plan_app_documents,
};
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_target::TargetRole;

use crate::CompiledApi;
use crate::filter_operations::{OperationSelection, filter_operations, with_operations};
use crate::planned_entry::PlannedEntry;
use crate::stop::Stop;

/// A planned document with the IR it serves: the api's, or the operations its servers keep.
#[derive(Debug, Clone)]
pub struct PlannedDocument {
    /// The document the config plans.
    pub planned: PlannedAppDocument,
    /// The IR it serves.
    pub ir: ContractIr,
}

/// The name of a planned document: `<api>`, or `<api>.<document>`.
#[must_use]
pub fn document_name(planned: &PlannedAppDocument) -> String {
    match &planned.document {
        Some(document) => format!("{}.{document}", planned.api),
        None => planned.api.clone(),
    }
}

fn compiled_ir<'compiled>(
    compiled: &'compiled [CompiledApi],
    planned: &PlannedAppDocument,
) -> Result<&'compiled ContractIr, InternalError> {
    compiled
        .iter()
        .find(|each| each.source == planned.source && each.api == planned.api)
        .map(|found| &found.ir)
        .ok_or_else(|| {
            InternalError::new(format!(
                "no compiled api {}/{}",
                planned.source, planned.api
            ))
        })
}

/// The IR with only the operations some server entry keeps; all of it when none restricts.
///
/// # Errors
///
/// [`Problems`] of the first entry filter that names something the api does not have.
pub fn served_ir(
    ir: &ContractIr,
    served_operations: Option<&[OperationsFilter]>,
) -> Result<ContractIr, Problems> {
    let Some(served_operations) = served_operations else {
        return Ok(ir.clone());
    };
    let mut kept_ids: Vec<String> = Vec::new();

    for operations in served_operations {
        let selection = OperationSelection {
            document: None,
            operations: Some(operations),
        };
        let filtered = filter_operations(ir, &selection)?;

        kept_ids.extend(
            filtered
                .operations
                .iter()
                .map(|operation| operation.id.to_string()),
        );
    }

    let kept = ir
        .operations
        .iter()
        .filter(|operation| kept_ids.iter().any(|id| id == operation.id.as_str()))
        .cloned()
        .collect();

    Ok(with_operations(ir, kept))
}

/// The documents of `config` with the IR each serves, planned from the entries whose target is a
/// server.
///
/// # Errors
///
/// [`Stop::Refused`] with the problems of the plan, [`Stop::Failed`] for a bug.
pub fn plan_documents(
    config: &LoadedAppConfig,
    entries: &[PlannedEntry],
    compiled: &[CompiledApi],
) -> Result<Vec<PlannedDocument>, Stop> {
    let api_documents: Vec<ApiDocuments> = compiled
        .iter()
        .map(|each| ApiDocuments {
            source: each.source.clone(),
            api: each.api.clone(),
            documents: each
                .ir
                .api
                .documents
                .keys()
                .map(ToString::to_string)
                .collect(),
        })
        .collect();
    let server_entries: Vec<&TargetEntrySettings> = entries
        .iter()
        .filter(|each| each.role == TargetRole::Server)
        .map(|each| &each.settings)
        .collect();
    let plan = plan_app_documents(config, &server_entries, &api_documents)?;
    let mut documents = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for planned in plan {
        let ir = compiled_ir(compiled, &planned)?;
        let location = format!("openapi document '{}'", document_name(&planned));

        match served_ir(ir, planned.served_operations.as_deref()) {
            Ok(served) => documents.push(PlannedDocument {
                planned,
                ir: served,
            }),
            Err(refused) => problems.extend(refused.into_iter().map(|problem| CliProblem {
                location: Some(location.clone()),
                ..problem
            })),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(documents)
}
