//! The Rust schema service answering the calls the TypeScript service recorded.

use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, TypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_oracle::{Fixture, HalfInput, RecordedCall, SubjectAnswer};
use seampact_pipeline::{TreeSchemaExampleIssue, TreeSchemaService};

use super::CompileFailure;
use super::half::{LoadedFixtureCache, tree_schemas_service};
use super::recorded_service::{
    CHECK_EXAMPLE, CHECK_TEXT_EXAMPLE, QUERY_WIRE, TYPE_USE, decode_json, json_of,
};

/// Answers every call of `calls` with the service `tree.schemas` builds for `api`, in order.
///
/// Each answer is encoded as the recorded one: `None` where the service answers nothing.
pub(super) fn replay_fixture_calls(
    cache: &LoadedFixtureCache,
    fixture: &Fixture,
    api: &str,
    input: &HalfInput<'_>,
    calls: &[RecordedCall],
) -> Result<SubjectAnswer<Vec<Option<JsonValue>>>, CompileFailure> {
    let service = match tree_schemas_service(cache, fixture, api, input)? {
        SubjectAnswer::Ported(service) => service,
        SubjectAnswer::NotPorted => return Ok(SubjectAnswer::NotPorted),
        SubjectAnswer::InternalError { message } => {
            return Ok(SubjectAnswer::InternalError { message });
        }
    };

    let answers = calls
        .iter()
        .map(|call| answer_call(&*service, call))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SubjectAnswer::Ported(answers))
}

/// The answer of `service` to one recorded call, encoded as the recorded answer is.
fn answer_call(
    service: &dyn TreeSchemaService,
    call: &RecordedCall,
) -> Result<Option<JsonValue>, InternalError> {
    match call.method.as_str() {
        TYPE_USE => {
            let direction: Direction = decoded_argument(call, 1)?;

            service
                .type_use(string_argument(call, 0)?, direction)?
                .map(|type_use| json_of(&type_use))
                .transpose()
        }
        QUERY_WIRE => service
            .query_wire(string_argument(call, 0)?)?
            .map(|wire| json_of(&wire))
            .transpose(),
        CHECK_EXAMPLE => {
            let schema_use: TypeUse = decoded_argument(call, 1)?;
            let issues = service.check_example(argument(call, 0)?, &schema_use)?;

            Ok(Some(issues_json(&issues)))
        }
        CHECK_TEXT_EXAMPLE => {
            let schema_use: TypeUse = decoded_argument(call, 1)?;
            let issues = service.check_text_example(string_argument(call, 0)?, &schema_use)?;

            Ok(Some(issues_json(&issues)))
        }
        other => Err(InternalError::new(format!(
            "the recorded schema call {other} is no method of the schema service"
        ))),
    }
}

fn argument(call: &RecordedCall, index: usize) -> Result<&JsonValue, InternalError> {
    call.args.get(index).ok_or_else(|| {
        InternalError::new(format!(
            "the recorded schema call {} has no argument {index}",
            call.method
        ))
    })
}

fn string_argument(call: &RecordedCall, index: usize) -> Result<&str, InternalError> {
    match argument(call, index)? {
        JsonValue::String(text) => Ok(text),
        _ => Err(InternalError::new(format!(
            "argument {index} of the recorded schema call {} is no string",
            call.method
        ))),
    }
}

fn decoded_argument<Value: serde::de::DeserializeOwned>(
    call: &RecordedCall,
    index: usize,
) -> Result<Value, InternalError> {
    decode_json(argument(call, index)?)
}

/// The issues of a check as the TypeScript records them: `[{ "pointer", "message" }]`.
fn issues_json(issues: &[TreeSchemaExampleIssue]) -> JsonValue {
    let entries = issues.iter().map(|issue| {
        let mut entry = JsonObject::new();

        entry.insert(
            "pointer".to_owned(),
            JsonValue::String(issue.pointer.clone()),
        );
        entry.insert(
            "message".to_owned(),
            JsonValue::String(issue.message.clone()),
        );

        JsonValue::Object(entry)
    });

    JsonValue::Array(entries.collect())
}

#[cfg(test)]
mod tests {
    use camino::Utf8PathBuf;

    use super::*;

    fn reference_fixture() -> Fixture {
        Fixture {
            path: "reference".to_owned(),
            directory: Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/reference"),
            entry: "workspace.yaml".to_owned(),
        }
    }

    fn call(method: &str, args: &str) -> RecordedCall {
        RecordedCall {
            method: method.to_owned(),
            args: serde_json::from_str(args).unwrap(),
            answer: None,
        }
    }

    fn replay(calls: &[RecordedCall]) -> SubjectAnswer<Vec<Option<JsonValue>>> {
        let input = HalfInput {
            deltas_before: &[],
            other_apis: Vec::new(),
        };

        match replay_fixture_calls(
            &LoadedFixtureCache::default(),
            &reference_fixture(),
            "tasks",
            &input,
            calls,
        ) {
            Ok(answer) => answer,
            Err(failure) => SubjectAnswer::InternalError {
                message: failure.to_string(),
            },
        }
    }

    #[test]
    fn a_type_use_is_answered_by_the_rust_service_and_a_missing_schema_by_nothing() {
        let answer = replay(&[
            call("typeUse", r#"["/schemas/Task", "input"]"#),
            call("typeUse", r#"["/schemas/NoSuchSchema", "input"]"#),
        ]);
        let SubjectAnswer::Ported(answers) = answer else {
            panic!("the replay ran: {answer:?}");
        };
        let expected: JsonValue =
            serde_json::from_str(r#"{"kind": "ref", "schema": "Task"}"#).unwrap();

        assert_eq!(answers, vec![Some(expected), None]);
    }

    #[test]
    fn a_check_is_answered_with_its_issues_as_pointer_and_message_objects() {
        let answer = replay(&[call(
            "checkTextExample",
            r#"["12", {"kind": "scalar", "type": "string", "refinements": {"minLength": 5}}]"#,
        )]);
        let SubjectAnswer::Ported(answers) = answer else {
            panic!("the replay ran: {answer:?}");
        };
        let Some(Some(JsonValue::Array(issues))) = answers.first() else {
            panic!("a list of issues expected, got {answers:?}");
        };

        assert_eq!(issues.len(), 1, "{issues:?}");
    }

    #[test]
    fn a_method_the_service_does_not_have_fails_the_replay_naming_it() {
        let answer = replay(&[call("noSuchMethod", "[]")]);
        let SubjectAnswer::InternalError { message } = answer else {
            panic!("an internal error expected, got {answer:?}");
        };

        assert!(message.contains("noSuchMethod"), "{message}");
    }
}
