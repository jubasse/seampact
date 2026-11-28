//! The OpenAPI document the `nativeDocs` artefact of an entry follows, emitted for its api.

use seampact_cli_config::{
    CliProblem, PlannedAppDocument, Problems, TargetEntrySettings, entry_where, located_problem,
};
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue};
use seampact_load::ResolvedScalar;
use seampact_load::yaml::{YamlKind, YamlNode, parse_yaml};
use seampact_openapi::{
    EmitOutcome, EmitterOptions, ParsedEmitterOptions, emit_documents, parse_emitter_options,
};
use seampact_span::SourceFiles;
use seampact_target::NativeDocsDocument;

use crate::filter_operations::is_in_document;
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
fn parse_emitted_document(text: &str) -> Result<JsonObject, Stop> {
    let mut files = SourceFiles::new();
    let file = files.add("emitted document", text).map_err(|error| {
        InternalError::new(format!("the emitted document is too long: {error}"))
    })?;
    let normalised = files
        .get(file)
        .map(|source| source.text().to_owned())
        .ok_or_else(|| InternalError::new("the emitted document is not registered"))?;
    let parsed = parse_yaml(file, &normalised)?;

    if let Some(problem) = parsed.problem {
        return Err(InternalError::new(format!(
            "the emitted document does not parse: {problem:?}"
        ))
        .into());
    }

    match parsed.root.as_ref().map(json_of_node).transpose()? {
        Some(JsonValue::Object(document)) => Ok(document),
        _ => Err(InternalError::new("the emitter wrote a document that is no object").into()),
    }
}

fn json_of_node(node: &YamlNode) -> Result<JsonValue, InternalError> {
    match &node.kind {
        YamlKind::Scalar { .. } => node
            .resolved_scalar()
            .map(ResolvedScalar::into_json_value)
            .ok_or_else(|| InternalError::new("a scalar of the emitted document did not resolve")),
        YamlKind::Sequence(items) => items
            .iter()
            .map(json_of_node)
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        YamlKind::Mapping(pairs) => {
            let mut object = JsonObject::new();

            for pair in pairs {
                let key = pair.key.scalar_text().ok_or_else(|| {
                    InternalError::new("a key of the emitted document is no text")
                })?;
                let value = match &pair.value {
                    Some(value) => json_of_node(value)?,
                    None => JsonValue::Null,
                };

                object.insert(key.to_owned(), value);
            }

            Ok(JsonValue::Object(object))
        }
        YamlKind::Alias(_) => Err(InternalError::new("the emitted document holds an alias")),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    type TestResult = Result<(), Stop>;

    #[test]
    fn integer_like_keys_come_first_in_ascending_order_as_javascript_lists_them() -> TestResult {
        let document = parse_emitted_document("b: 1\n'200': ok\n'4': ok\na: 2\n")?;
        let keys: Vec<&str> = document.keys().map(String::as_str).collect();

        assert_eq!(keys, ["4", "200", "b", "a"]);

        Ok(())
    }

    #[test]
    fn quoted_scalars_stay_text_and_plain_ones_resolve() -> TestResult {
        let document =
            parse_emitted_document("code: '123'\nflag: true\nnothing: null\nbig: 1e+21\n")?;

        assert_eq!(
            document.get("code"),
            Some(&JsonValue::String("123".to_owned()))
        );
        assert_eq!(document.get("flag"), Some(&JsonValue::Bool(true)));
        assert_eq!(document.get("nothing"), Some(&JsonValue::Null));
        assert!(matches!(document.get("big"), Some(JsonValue::Number(_))));

        Ok(())
    }

    #[test]
    fn a_document_that_is_no_object_is_a_bug() {
        assert!(parse_emitted_document("- 1\n").is_err());
    }
}
