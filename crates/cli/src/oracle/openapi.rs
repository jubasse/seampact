//! The OpenAPI cases: the documents of one IR, and the merge of several.

use seampact_ir::ContractIr;
use seampact_json::{JsonObject, JsonValue, canonical_document};
use seampact_openapi::{EmitOutcome, ParsedEmitterOptions, emit_documents, parse_emitter_options};
use seampact_oracle::{MergeCase, OpenApiAnswer, SubjectAnswer};
use seampact_target::Refusal;

use crate::oracle::stub_answer::failed_answer;

/// The document name of an api that declares none, as `openapi/default.yaml` names it.
const DEFAULT_DOCUMENT_NAME: &str = "default";

/// Emits the documents of `ir` under the raw emitter options `options`.
pub(crate) fn openapi_answer(
    ir: &JsonValue,
    options: Option<&JsonValue>,
) -> SubjectAnswer<OpenApiAnswer> {
    let ir = match ContractIr::from_json_text(&canonical_document(ir)) {
        Ok(ir) => ir,
        Err(error) => {
            return SubjectAnswer::InternalError {
                message: format!("the expected IR does not read back: {error}"),
            };
        }
    };

    let options = match parse_emitter_options(options) {
        Ok(ParsedEmitterOptions::Parsed(options)) => options,
        Ok(ParsedEmitterOptions::Refused(refusals)) => {
            return SubjectAnswer::Ported(OpenApiAnswer::Refusals(refusals_json(&refusals)));
        }
        Err(error) => return failed_answer(&error),
    };

    match emit_documents(&ir, &options) {
        Ok(EmitOutcome::Emitted(documents)) => {
            let documents = documents
                .into_iter()
                .map(|document| {
                    let name = document.name.map_or_else(
                        || DEFAULT_DOCUMENT_NAME.to_owned(),
                        |name| name.as_str().to_owned(),
                    );

                    (name, document.text)
                })
                .collect();

            SubjectAnswer::Ported(OpenApiAnswer::Documents(documents))
        }
        Ok(EmitOutcome::Refused(refusals)) => {
            SubjectAnswer::Ported(OpenApiAnswer::Refusals(refusals_json(&refusals)))
        }
        Err(error) => failed_answer(&error),
    }
}

/// Merges the documents of `case`. The brief that ports `mergeDocuments` builds its inputs here.
pub(crate) fn openapi_merge_answer(_case: &MergeCase) -> SubjectAnswer<OpenApiAnswer> {
    SubjectAnswer::NotPorted
}

/// The refusals as `openapi/refusals.json` holds them, absent members left out.
fn refusals_json(refusals: &[Refusal]) -> JsonValue {
    let entries = refusals
        .iter()
        .map(|refusal| {
            let mut entry = JsonObject::new();

            entry.insert("code".to_owned(), JsonValue::String(refusal.code.clone()));
            entry.insert(
                "message".to_owned(),
                JsonValue::String(refusal.message.clone()),
            );
            entry.insert("fix".to_owned(), JsonValue::String(refusal.fix.clone()));

            if let Some(operation) = &refusal.operation {
                entry.insert(
                    "operation".to_owned(),
                    JsonValue::String(operation.as_str().to_owned()),
                );
            }

            if let Some(member) = &refusal.member {
                entry.insert("member".to_owned(), JsonValue::String(member.clone()));
            }

            if let Some(docs) = &refusal.docs {
                entry.insert("docs".to_owned(), JsonValue::String(docs.clone()));
            }

            JsonValue::Object(entry)
        })
        .collect();

    JsonValue::Array(entries)
}
