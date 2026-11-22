//! The OpenAPI cases: the documents of one IR, and the merge of several.

use seampact_ir::{ContractIr, OperationId};
use seampact_json::{JsonObject, JsonValue, canonical_document};
use seampact_openapi::{
    EmitOutcome, OpenApiError, ParsedEmitterOptions, emit_documents, parse_emitter_options,
};
use seampact_oracle::{MergeCase, OpenApiAnswer, SubjectAnswer};
use seampact_target::Refusal;

use crate::oracle::stub_answer::{StubError, failed_answer};

impl StubError for OpenApiError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

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
    JsonValue::Array(refusals.iter().map(refusal_json).collect())
}

fn refusal_json(refusal: &Refusal) -> JsonValue {
    let text = |value: &str| JsonValue::String(value.to_owned());
    let mut entry = JsonObject::from_iter([
        ("code".to_owned(), text(&refusal.code)),
        ("message".to_owned(), text(&refusal.message)),
        ("fix".to_owned(), text(&refusal.fix)),
    ]);
    let optional_members = [
        ("docs", refusal.docs.as_deref()),
        ("member", refusal.member.as_deref()),
        (
            "operation",
            refusal.operation.as_ref().map(OperationId::as_str),
        ),
    ];

    for (name, value) in optional_members {
        if let Some(present) = value {
            entry.insert(name.to_owned(), text(present));
        }
    }

    JsonValue::Object(entry)
}
