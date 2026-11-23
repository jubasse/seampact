//! The OpenAPI documents of an app, rendered from the IR each serves.

use seampact_cli_config::{CheckLevel, CliProblem, OperationsFilter, Problems};
use seampact_diagnostics::InternalError;
use seampact_openapi::{
    EmitOutcome, EmitterOptions, ParsedEmitterOptions, emit_documents, parse_emitter_options,
};

use crate::EmittedAppDocument;
use crate::planned_document::{PlannedDocument, document_name};
use crate::refusal_problem::problem_from_refusal;
use crate::stop::Stop;

/// What decides that two documents render alike: the api, the operations served and the options.
#[derive(PartialEq)]
struct EmissionKey {
    source: String,
    api: String,
    served_operations: Option<Vec<OperationsFilter>>,
    options: EmitterOptions,
}

/// Renders each planned document at `level`, or reports every document the emitter refuses; an
/// api rendered twice for the same operations and options is rendered once.
///
/// # Errors
///
/// [`Stop::Refused`] with the problems of the documents the emitter refuses, [`Stop::Failed`] for
/// a bug or a render failure.
pub fn emit_app_documents(
    documents: &[PlannedDocument],
    level: CheckLevel,
) -> Result<Vec<EmittedAppDocument>, Stop> {
    let mut emitted_apis: Vec<(EmissionKey, EmitOutcome)> = Vec::new();
    let mut emitted = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for PlannedDocument { planned, ir } in documents {
        let name = document_name(planned);
        let location = format!("openapi document '{name}' ({})", planned.file);
        let options = match parse_emitter_options(Some(&planned.options))? {
            ParsedEmitterOptions::Refused(refusals) => {
                problems.extend(
                    refusals
                        .iter()
                        .map(|refusal| problem_from_refusal(refusal, location.clone(), None)),
                );

                continue;
            }
            ParsedEmitterOptions::Parsed(options) => options,
        };
        let key = EmissionKey {
            source: planned.source.clone(),
            api: planned.api.clone(),
            served_operations: planned.served_operations.clone(),
            options,
        };
        let known = emitted_apis.iter().position(|(each, _)| *each == key);
        let index = if let Some(index) = known {
            index
        } else {
            let outcome = emit_documents(ir, &key.options)?;

            emitted_apis.push((key, outcome));

            emitted_apis.len() - 1
        };
        let Some((_, outcome)) = emitted_apis.get(index) else {
            return Err(InternalError::new("an emitted api vanished from its cache").into());
        };

        let rendered = match outcome {
            EmitOutcome::Refused(refusals) => {
                problems.extend(
                    refusals
                        .iter()
                        .map(|refusal| problem_from_refusal(refusal, location.clone(), None)),
                );

                continue;
            }
            EmitOutcome::Emitted(rendered) => rendered,
        };
        let document = rendered
            .iter()
            .find(|each| {
                each.name.as_ref().map(seampact_ir::DocumentId::as_str)
                    == planned.document.as_deref()
            })
            .ok_or_else(|| InternalError::new(format!("the emitter wrote no document {name}")))?;

        emitted.push(EmittedAppDocument {
            name,
            file: planned.file.clone(),
            text: document.text.clone(),
            level,
        });
    }

    Problems::refuse_any(problems)?;

    Ok(emitted)
}
