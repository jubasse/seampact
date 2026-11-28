//! The OpenAPI cases: the documents of one IR, and the merge of several.

use seampact_ir::{ContractIr, DocumentId, OperationId};
use seampact_json::{JsonValue, canonical_document};
use seampact_openapi::{
    EmitOutcome, MergeInput, MergeOptions, MergeOutcome, ParsedEmitterOptions, emit_documents,
    merge_documents, parse_emitter_options,
};
use seampact_oracle::{MergeCase, OpenApiAnswer, SubjectAnswer};
use seampact_target::Refusal;

use crate::oracle::failed_answer::failed_answer;
use crate::oracle::json::{array_of, coded_problem_json};

/// The document name of an api that declares none, as `openapi/default.yaml` names it.
const DEFAULT_DOCUMENT_NAME: &str = "default";

/// The name the merged document answers under; the oracle compares it as `merged.yaml`.
const MERGED_DOCUMENT_NAME: &str = "merged";

/// Emits the documents of `ir` under the raw emitter options `options`.
pub(crate) fn openapi_answer(
    ir: &JsonValue,
    options: Option<&JsonValue>,
) -> SubjectAnswer<OpenApiAnswer> {
    let ir = match read_ir(ir) {
        Ok(ir) => ir,
        Err(answer) => return answer,
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

/// Merges the documents of `case`: each input's IR, the prefixes and the emitter options.
pub(crate) fn openapi_merge_answer(case: &MergeCase) -> SubjectAnswer<OpenApiAnswer> {
    let emitter = match parse_emitter_options(case.emitter.as_ref()) {
        Ok(ParsedEmitterOptions::Parsed(options)) => options,
        Ok(ParsedEmitterOptions::Refused(refusals)) => {
            return SubjectAnswer::Ported(OpenApiAnswer::Refusals(refusals_json(&refusals)));
        }
        Err(error) => return failed_answer(&error),
    };
    let mut inputs = Vec::with_capacity(case.inputs.len());

    for case_input in &case.inputs {
        match read_ir(&case_input.ir) {
            Ok(ir) => inputs.push(MergeInput {
                ir,
                document: case_input.document.clone().map(DocumentId::new),
            }),
            Err(answer) => return answer,
        }
    }

    let options = MergeOptions {
        name: case.name.clone(),
        prefix: case.prefix.clone(),
        emitter,
    };

    match merge_documents(&inputs, &options) {
        Ok(MergeOutcome::Merged { text }) => {
            SubjectAnswer::Ported(OpenApiAnswer::Documents(vec![(
                MERGED_DOCUMENT_NAME.to_owned(),
                text,
            )]))
        }
        Ok(MergeOutcome::Refused(refusals)) => {
            SubjectAnswer::Ported(OpenApiAnswer::Refusals(refusals_json(&refusals)))
        }
        Err(error) => failed_answer(&error),
    }
}

/// The IR of an expected `ir/<api>.json`, or the answer that says it does not read back.
fn read_ir(ir: &JsonValue) -> Result<ContractIr, SubjectAnswer<OpenApiAnswer>> {
    ContractIr::from_json_text(&canonical_document(ir)).map_err(|error| {
        SubjectAnswer::InternalError {
            message: format!("the expected IR does not read back: {error}"),
        }
    })
}

/// The refusals as `openapi/refusals.json` holds them, absent members left out.
fn refusals_json(refusals: &[Refusal]) -> JsonValue {
    array_of(refusals, refusal_json)
}

fn refusal_json(refusal: &Refusal) -> JsonValue {
    coded_problem_json(
        &refusal.code,
        &refusal.message,
        &refusal.fix,
        [
            ("docs", refusal.docs.as_deref()),
            ("member", refusal.member.as_deref()),
            (
                "operation",
                refusal.operation.as_ref().map(OperationId::as_str),
            ),
        ],
    )
}
