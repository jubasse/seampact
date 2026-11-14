//! The schema service of the TypeScript run, answered from the calls it recorded.

use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, QueryWire, TypeUse};
use seampact_json::{JsonValue, canonical_json};
use seampact_oracle::RecordedCall;
use seampact_pipeline::{PassError, TreeSchemaExampleIssue, TreeSchemaService};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// The TypeScript name of [`TreeSchemaService::type_use`].
const TYPE_USE: &str = "typeUse";
/// The TypeScript name of [`TreeSchemaService::query_wire`].
const QUERY_WIRE: &str = "queryWire";
/// The TypeScript name of [`TreeSchemaService::check_example`].
const CHECK_EXAMPLE: &str = "checkExample";
/// The TypeScript name of [`TreeSchemaService::check_text_example`].
const CHECK_TEXT_EXAMPLE: &str = "checkTextExample";

/// A schema service that answers each call as the TypeScript service answered it.
///
/// A call is looked up by the canonical JSON of `[method, args]`, its arguments encoded as
/// `schema-calls/<api>.json` writes them; a call the TypeScript halves never made is a
/// [`PassError::Internal`] naming it, so a later half never reads an answer nobody recorded.
#[derive(Debug, Clone, Default)]
pub struct RecordedSchemaService {
    answers: HashMap<String, Option<JsonValue>>,
}

impl RecordedSchemaService {
    /// The service of `calls`, which it copies.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when two calls ask one question and record two answers.
    pub fn new(calls: &[RecordedCall]) -> Result<Self, InternalError> {
        let mut answers: HashMap<String, Option<JsonValue>> = HashMap::with_capacity(calls.len());

        for call in calls {
            let key = call_key(&call.method, call.args.clone());

            if let Some(recorded) = answers.get(&key)
                && *recorded != call.answer
            {
                return Err(InternalError::new(format!(
                    "the recorded schema calls answer {key} twice, differently"
                )));
            }

            answers.insert(key, call.answer.clone());
        }

        Ok(Self { answers })
    }

    /// The recorded answer of `method` with `args`, `None` where the TypeScript answered
    /// `undefined`.
    fn answer(&self, method: &str, args: Vec<JsonValue>) -> Result<Option<&JsonValue>, PassError> {
        let key = call_key(method, args);

        match self.answers.get(&key) {
            Some(answer) => Ok(answer.as_ref()),
            None => Err(InternalError::new(format!(
                "the schema service call {key} was not recorded by the TypeScript halves"
            ))
            .into()),
        }
    }

    /// The recorded answer of a check, which the TypeScript always answers with a list.
    fn issues(
        &self,
        method: &str,
        args: Vec<JsonValue>,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        let key = call_key(method, args.clone());

        let Some(answer) = self.answer(method, args)? else {
            return Err(InternalError::new(format!(
                "the schema service call {key} has no recorded answer, where the TypeScript answers a list"
            ))
            .into());
        };

        Ok(issues_of(answer, &key)?)
    }
}

impl TreeSchemaService for RecordedSchemaService {
    fn type_use(&self, pointer: &str, direction: Direction) -> Result<Option<TypeUse>, PassError> {
        let args = vec![JsonValue::String(pointer.to_owned()), json_of(&direction)?];

        decoded(self.answer(TYPE_USE, args)?)
    }

    fn query_wire(&self, pointer: &str) -> Result<Option<QueryWire>, PassError> {
        let args = vec![JsonValue::String(pointer.to_owned())];

        decoded(self.answer(QUERY_WIRE, args)?)
    }

    fn check_example(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        self.issues(CHECK_EXAMPLE, vec![value.clone(), json_of(schema_use)?])
    }

    fn check_text_example(
        &self,
        text: &str,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        self.issues(
            CHECK_TEXT_EXAMPLE,
            vec![JsonValue::String(text.to_owned()), json_of(schema_use)?],
        )
    }
}

/// The lookup key of a call: the canonical JSON of `[method, args]`.
fn call_key(method: &str, args: Vec<JsonValue>) -> String {
    canonical_json(&JsonValue::Array(vec![
        JsonValue::String(method.to_owned()),
        JsonValue::Array(args),
    ]))
}

/// An argument in its IR serde form.
fn json_of(argument: &impl Serialize) -> Result<JsonValue, InternalError> {
    let value = serde_json::to_value(argument).map_err(|failure| {
        InternalError::new(format!("a schema call argument does not encode: {failure}"))
    })?;

    JsonValue::try_from(value).map_err(|failure| {
        InternalError::new(format!(
            "a schema call argument is no JSON value: {failure}"
        ))
    })
}

/// A recorded answer read through its serde form.
fn decoded<Answer: DeserializeOwned>(
    answer: Option<&JsonValue>,
) -> Result<Option<Answer>, PassError> {
    let Some(answer) = answer else {
        return Ok(None);
    };

    let value = serde_json::to_value(answer).map_err(|failure| {
        InternalError::new(format!("a recorded answer does not encode: {failure}"))
    })?;
    let decoded_answer = serde_json::from_value(value).map_err(|failure| {
        InternalError::new(format!("a recorded answer does not decode: {failure}"))
    })?;

    Ok(Some(decoded_answer))
}

/// The issues of a recorded check answer: `[{ "pointer", "message" }]`.
fn issues_of(answer: &JsonValue, key: &str) -> Result<Vec<TreeSchemaExampleIssue>, InternalError> {
    let JsonValue::Array(entries) = answer else {
        return Err(InternalError::new(format!(
            "the recorded answer of {key} is no list"
        )));
    };

    entries
        .iter()
        .map(|entry| {
            let (Some(JsonValue::String(pointer)), Some(JsonValue::String(message))) =
                (member_of(entry, "pointer"), member_of(entry, "message"))
            else {
                return Err(InternalError::new(format!(
                    "an issue recorded for {key} has no string pointer and message"
                )));
            };

            Ok(TreeSchemaExampleIssue {
                pointer: pointer.clone(),
                message: message.clone(),
            })
        })
        .collect()
}

fn member_of<'value>(value: &'value JsonValue, name: &str) -> Option<&'value JsonValue> {
    match value {
        JsonValue::Object(members) => members.get(name),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(method: &str, args: &str, answer: Option<&str>) -> RecordedCall {
        RecordedCall {
            method: method.to_owned(),
            args: serde_json::from_str(args).unwrap(),
            answer: answer.map(|text| serde_json::from_str(text).unwrap()),
        }
    }

    fn scalar_use() -> TypeUse {
        serde_json::from_str(r#"{"kind": "scalar", "type": "string", "refinements": {}}"#).unwrap()
    }

    fn service() -> RecordedSchemaService {
        RecordedSchemaService::new(&[
            call(
                "typeUse",
                r#"["/a", "input"]"#,
                Some(r#"{"kind": "ref", "schema": "A"}"#),
            ),
            call("typeUse", r#"["/b", "output"]"#, None),
            call(
                "checkExample",
                r#"[{"y": 1, "x": "été"}, {"kind": "scalar", "type": "string", "refinements": {}}]"#,
                Some(r#"[{"pointer": "", "message": "is no string"}]"#),
            ),
            call(
                "checkTextExample",
                r#"["12", {"kind": "scalar", "type": "string", "refinements": {}}]"#,
                None,
            ),
        ])
        .unwrap()
    }

    #[test]
    fn a_recorded_call_answers_its_decoded_answer_and_an_absent_one_none() {
        let service = service();
        let answered = service.type_use("/a", Direction::Input).unwrap();

        assert!(
            matches!(answered, Some(TypeUse::Ref(reference)) if reference.schema.as_str() == "A")
        );
        assert_eq!(service.type_use("/b", Direction::Output), Ok(None));
    }

    #[test]
    fn a_check_is_found_whatever_the_key_order_of_its_value() {
        let value: JsonValue = serde_json::from_str(r#"{"x": "été", "y": 1}"#).unwrap();
        let issues = service().check_example(&value, &scalar_use()).unwrap();

        assert_eq!(
            issues,
            vec![TreeSchemaExampleIssue {
                pointer: String::new(),
                message: "is no string".to_owned(),
            }]
        );
    }

    #[test]
    fn a_call_nobody_recorded_fails_naming_the_method_and_its_arguments() {
        let failure = service()
            .query_wire("/never/asked")
            .unwrap_err()
            .to_string();

        assert!(
            failure.contains(r#"["queryWire",["/never/asked"]]"#),
            "{failure}"
        );
    }

    #[test]
    fn a_check_recorded_without_an_answer_fails_where_the_typescript_answers_a_list() {
        let failure = service()
            .check_text_example("12", &scalar_use())
            .unwrap_err()
            .to_string();

        assert!(failure.contains("checkTextExample"), "{failure}");
        assert!(failure.contains("has no recorded answer"), "{failure}");
    }

    #[test]
    fn one_question_recorded_with_two_answers_is_refused() {
        let failure = RecordedSchemaService::new(&[
            call("queryWire", r#"["/q"]"#, None),
            call("queryWire", r#"["/q"]"#, Some("{}")),
        ])
        .unwrap_err();

        assert!(failure.what().contains("twice"), "{failure}");
    }
}
