//! The OpenAPI document the `nativeDocs` artefact of an entry follows, emitted for its api.

use seampact_cli_config::{
    CliProblem, PlannedAppDocument, Problems, TargetEntrySettings, entry_where, located_problem,
};
use seampact_diagnostics::InternalError;
use seampact_json::JsonObject;
use seampact_openapi::{
    EmitOutcome, EmitterOptions, ParsedEmitterOptions, emit_documents, parse_emitter_options,
};
use seampact_target::NativeDocsDocument;

use crate::filter_operations::is_in_document;
use crate::not_ported::not_ported_yet;
use crate::planned_entry::PlannedApi;
use crate::refusal_problem::{problem_from_refusal, problems_at_api};
use crate::stop::Stop;

/// The document of `planned_api` that `entry` follows, emitted under the options its placement
/// writes.
///
/// # Errors
///
/// [`Stop::Refused`] when the entry names no document and several fit, when the options of the
/// placement are refused or the emitter refuses the api; [`Stop::Failed`] for a bug.
pub(crate) fn native_docs_document_of(
    entry: &TargetEntrySettings,
    planned_api: &PlannedApi,
    app_documents: &[&PlannedAppDocument],
) -> Result<NativeDocsDocument, Stop> {
    let location = entry_where(&entry.id, Some(&planned_api.api));
    let name = chosen_document_name(entry, planned_api, &location)?;
    let options = emitter_options_of(planned_api, name.as_deref(), app_documents, &location)?;
    let rendered = match emit_documents(&planned_api.ir, &options).map_err(Stop::from)? {
        EmitOutcome::Refused(refusals) => {
            let problems = problems_at_api(&refusals, |_| location.clone(), planned_api)?;

            return Err(Problems::new(problems).into());
        }
        EmitOutcome::Emitted(rendered) => rendered,
    };
    let document = rendered
        .iter()
        .find(|each| each.name.as_ref().map(seampact_ir::DocumentId::as_str) == name.as_deref())
        .ok_or_else(|| {
            InternalError::new(format!(
                "the emitter wrote no document {} as an object",
                name.as_deref().unwrap_or(&planned_api.api)
            ))
        })?;

    Ok(NativeDocsDocument {
        name,
        document: parse_emitted_document(&document.text)?,
    })
}

/// The emitted YAML read back as the object the target receives.
fn parse_emitted_document(_text: &str) -> Result<JsonObject, Stop> {
    Err(not_ported_yet("parse").into())
}

/// The document name the entry names, or the one document of the api that holds every route.
fn chosen_document_name(
    entry: &TargetEntrySettings,
    planned_api: &PlannedApi,
    location: &str,
) -> Result<Option<String>, Problems> {
    if let Some(document) = &entry.document {
        return Ok(Some(document.clone()));
    }

    let declared: Vec<&str> = planned_api
        .ir
        .api
        .documents
        .keys()
        .map(seampact_ir::DocumentId::as_str)
        .collect();

    if declared.is_empty() {
        return Ok(None);
    }

    let holding_every_route: Vec<&str> = declared
        .iter()
        .copied()
        .filter(|id| {
            planned_api
                .ir
                .operations
                .iter()
                .all(|operation| is_in_document(&planned_api.ir, Some(id), operation))
        })
        .collect();

    match holding_every_route.as_slice() {
        [only] => Ok(Some((*only).to_owned())),
        _ => Err(Problems::new(vec![ambiguous_document_problem(
            &declared,
            &holding_every_route,
            location,
        )])),
    }
}

fn ambiguous_document_problem(
    declared: &[&str],
    holding_every_route: &[&str],
    location: &str,
) -> CliProblem {
    let why = if holding_every_route.is_empty() {
        "none of them holds every route the entry generates".to_owned()
    } else {
        format!(
            "{} each hold every route the entry generates",
            quoted(holding_every_route)
        )
    };
    let suggested = if holding_every_route.is_empty() {
        declared
    } else {
        holding_every_route
    };

    located_problem(
        "nativeDocs.document.ambiguous",
        format!(
            "The api declares the documents {}; {why}, so the framework's document cannot follow one of them.",
            quoted(declared)
        ),
        &format!(
            "Set `document` on the entry to the document the framework's document describes ({}), or drop `nativeDocs`.",
            quoted(suggested)
        ),
        location.to_owned(),
    )
}

fn quoted(ids: &[&str]) -> String {
    let quoted: Vec<String> = ids.iter().map(|id| format!("'{id}'")).collect();

    quoted.join(", ")
}

/// The options of the placement of the document `name` of the api, without its servers; the
/// defaults when the app places no such document.
fn emitter_options_of(
    planned_api: &PlannedApi,
    name: Option<&str>,
    app_documents: &[&PlannedAppDocument],
    location: &str,
) -> Result<EmitterOptions, Stop> {
    let placed = app_documents.iter().find(|each| {
        each.source == planned_api.source
            && each.api == planned_api.api
            && each.document.as_deref() == name
    });
    let Some(placed) = placed else {
        return Ok(EmitterOptions::default());
    };

    match parse_emitter_options(Some(&placed.options))? {
        ParsedEmitterOptions::Refused(refusals) => {
            let problems = refusals
                .iter()
                .map(|refusal| problem_from_refusal(refusal, location.to_owned(), None))
                .collect();

            Err(Problems::new(problems).into())
        }
        ParsedEmitterOptions::Parsed(options) => Ok(EmitterOptions {
            servers: Vec::new(),
            ..options
        }),
    }
}
