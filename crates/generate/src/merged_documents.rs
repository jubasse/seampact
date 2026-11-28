//! The merged documents of a root, each holding what its apps contribute.

use indexmap::IndexMap;
use seampact_cli_config::{
    CliProblem, LoadedWorkspace, MergedApp, MergedContribution, MergedPlanError,
    PlannedMergedDocument, Problems, parse_api_ref, plan_merged_documents,
};
use seampact_diagnostics::InternalError;
use seampact_ir::DocumentId;
use seampact_json::JsonValue;
use seampact_openapi::{
    MergeInput, MergeOptions, MergeOutcome, ParsedEmitterOptions, merge_documents,
    parse_emitter_options,
};
use seampact_target::TargetRole;
use std::slice;

use crate::drift_level::DEFAULT_DRIFT_CHECK_LEVEL;
use crate::planned_document::served_ir;
use crate::refusal_problem::problem_from_refusal;
use crate::stop::{Stop, gather};
use crate::{AppPlan, EmittedAppDocument};

/// Renders the merged documents of `workspace` from the plan of each app, by the app's name in
/// the root's `apps`.
///
/// # Errors
///
/// [`Stop::Refused`] with the problems of every document the plan or the merge refuses;
/// [`Stop::Failed`] for a bug or a render failure.
pub fn emit_merged_documents(
    workspace: &LoadedWorkspace,
    plans: &IndexMap<&str, &AppPlan<'_>>,
) -> Result<Vec<EmittedAppDocument>, Stop> {
    let apps: Vec<MergedApp<'_>> = plans
        .iter()
        .map(|(name, plan)| MergedApp {
            name,
            config: plan.config,
            server_entries: plan
                .entries
                .iter()
                .filter(|entry| entry.role == TargetRole::Server)
                .map(|entry| &entry.settings)
                .collect(),
        })
        .collect();
    let planned = plan_merged_documents(&workspace.root, &apps).map_err(|error| match error {
        MergedPlanError::Refused(problems) => Stop::from(problems),
        MergedPlanError::Internal(internal) => Stop::from(internal),
    })?;
    let level = workspace
        .root
        .checks_settings
        .openapi
        .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL);
    let mut emitted = Vec::new();
    let mut problems = Vec::new();

    for document in &planned {
        if let Some(text) = gather(merged_text(document, plans), &mut problems)? {
            emitted.push(EmittedAppDocument {
                name: document.name.clone(),
                file: document.file.clone(),
                text,
                level,
            });
        }
    }

    Problems::refuse_any(problems)?;

    Ok(emitted)
}

fn merged_text(
    planned: &PlannedMergedDocument,
    plans: &IndexMap<&str, &AppPlan<'_>>,
) -> Result<String, Stop> {
    let location = format!(
        "merged openapi document '{}' ({})",
        planned.name, planned.file
    );
    let emitter = match parse_emitter_options(Some(&planned.options))? {
        ParsedEmitterOptions::Refused(refusals) => {
            let problems = refusals
                .iter()
                .map(|refusal| problem_from_refusal(refusal, location.clone(), None))
                .collect();

            return Err(Problems::new(problems).into());
        }
        ParsedEmitterOptions::Parsed(options) => options,
    };
    let mut inputs = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for contribution in &planned.contributions {
        let mut refused = Vec::new();

        if let Some(input) = gather(merge_input(contribution, plans), &mut refused)? {
            inputs.push(input);
        }

        problems.extend(refused.into_iter().map(|problem| CliProblem {
            location: Some(location.clone()),
            ..problem
        }));
    }

    Problems::refuse_any(problems)?;

    let options = MergeOptions {
        name: planned.name.clone(),
        prefix: prefix_of(&planned.prefix)?,
        emitter,
    };

    match merge_documents(&inputs, &options)? {
        MergeOutcome::Merged { text } => Ok(text),
        MergeOutcome::Refused(refusals) => {
            let problems = refusals
                .iter()
                .map(|refusal| problem_from_refusal(refusal, location.clone(), None))
                .collect();

            Err(Problems::new(problems).into())
        }
    }
}

fn merge_input(
    contribution: &MergedContribution,
    plans: &IndexMap<&str, &AppPlan<'_>>,
) -> Result<MergeInput, Stop> {
    let plan = plans
        .get(contribution.app.as_str())
        .ok_or_else(|| InternalError::new(format!("no plan for the app {}", contribution.app)))?;
    let reference = parse_api_ref(&contribution.api);
    let found = plan
        .compiled
        .iter()
        .find(|each| {
            each.api == reference.api && reference.source.is_none_or(|source| each.source == source)
        })
        .ok_or_else(|| {
            InternalError::new(format!(
                "the app {} compiled no api {}",
                contribution.app, contribution.api
            ))
        })?;
    let served = served_ir(
        &found.ir,
        contribution.operations.as_ref().map(slice::from_ref),
    )?;

    Ok(MergeInput {
        ir: served,
        document: contribution.document.clone().map(DocumentId::new),
    })
}

/// The prefix of each api as the root writes it: an object of texts.
fn prefix_of(prefix: &JsonValue) -> Result<IndexMap<String, String>, InternalError> {
    let JsonValue::Object(members) = prefix else {
        return Err(InternalError::new(
            "a merged document's prefix is no mapping",
        ));
    };

    members
        .iter()
        .map(|(api, value)| match value.as_text() {
            Some(text) => Ok((api.clone(), text.to_owned())),
            None => Err(InternalError::new(format!(
                "the prefix of the api {api} is no text"
            ))),
        })
        .collect()
}
