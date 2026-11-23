//! The OpenAPI documents an app plans, each with the IR it serves.

use indexmap::IndexMap;
use seampact_cli_config::{
    ApiDocuments, AppDocumentPlan, CliProblem, LoadedAppConfig, OperationsFilter,
    PlannedAppDocument, Step, plan_app_documents,
};
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_target::TargetRole;

use crate::filter_operations::{FilterOutcome, OperationSelection, filter_operations};
use crate::{CompiledApi, GenerateError};

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
#[must_use]
pub fn served_ir(
    ir: &ContractIr,
    served_operations: Option<&[OperationsFilter]>,
) -> Step<ContractIr> {
    let Some(served_operations) = served_operations else {
        return Step::Done(ir.clone());
    };
    let mut kept_ids: Vec<String> = Vec::new();

    for operations in served_operations {
        let selection = OperationSelection {
            document: None,
            operations: Some(operations),
        };

        match filter_operations(ir, &selection) {
            FilterOutcome::Refused(problems) => return Step::Refused(problems),
            FilterOutcome::Filtered(filtered) => {
                kept_ids.extend(
                    filtered
                        .operations
                        .iter()
                        .map(|operation| operation.id.to_string()),
                );
            }
        }
    }

    let mut served = ir.clone();

    served
        .operations
        .retain(|operation| kept_ids.iter().any(|id| id == operation.id.as_str()));

    Step::Done(served)
}

/// The documents of `config` with the IR each serves, or the problems of its plan.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until `planAppDocuments` is ported, [`GenerateError::Internal`]
/// for a bug.
pub fn plan_documents(
    config: &LoadedAppConfig,
    roles: &IndexMap<String, TargetRole>,
    compiled: &[CompiledApi],
) -> Result<Step<Vec<PlannedDocument>>, GenerateError> {
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

    let plan = match plan_app_documents(config, roles, &api_documents)? {
        AppDocumentPlan::Refused(problems) => return Ok(Step::Refused(problems)),
        AppDocumentPlan::Planned(planned) => planned,
    };
    let mut documents = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for planned in plan {
        let ir = compiled_ir(compiled, &planned)?;

        match served_ir(ir, planned.served_operations.as_deref()) {
            Step::Refused(refused) => {
                let location = format!("openapi document '{}'", document_name(&planned));

                problems.extend(refused.into_iter().map(|problem| CliProblem {
                    location: Some(location.clone()),
                    ..problem
                }));
            }
            Step::Done(served) => documents.push(PlannedDocument {
                planned,
                ir: served,
            }),
        }
    }

    if problems.is_empty() {
        Ok(Step::Done(documents))
    } else {
        Ok(Step::Refused(problems))
    }
}
