//! The strict check on real IR documents and on the number edge values.

use std::error::Error;
use std::fs;

use seampact_ir_check::{
    IrCheckFailure, check_source_map, check_strict_ir, serde_value_through_f64,
};
use seampact_json::JsonValue;

type TestResult = Result<(), Box<dyn Error>>;

const FIXTURE_IR: &str = "../../fixtures/expected/reference/ir/tasksOptionalAuth.json";
const FIXTURE_SOURCE_MAP: &str =
    "../../fixtures/expected/reference/source-map/tasksOptionalAuth.json";

fn read(path: &str) -> Result<JsonValue, Box<dyn Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn edit_member(document: &mut JsonValue, member: &str, value: JsonValue) {
    if let JsonValue::Object(members) = document {
        members.insert(member.to_owned(), value);
    }
}

#[test]
fn a_real_ir_and_its_source_map_pass() -> TestResult {
    assert_eq!(check_strict_ir(&read(FIXTURE_IR)?)?, Vec::new());
    assert_eq!(check_source_map(&read(FIXTURE_SOURCE_MAP)?)?, Vec::new());

    Ok(())
}

#[test]
fn an_unknown_top_level_member_is_reported_by_pointer() -> TestResult {
    let mut ir = read(FIXTURE_IR)?;

    edit_member(&mut ir, "surprise", JsonValue::Bool(true));

    assert_eq!(
        check_strict_ir(&ir)?,
        vec![IrCheckFailure::UnknownMember {
            pointer: "/surprise".to_owned()
        }]
    );

    Ok(())
}

#[test]
fn a_wrong_type_is_a_schema_failure() -> TestResult {
    let mut ir = read(FIXTURE_IR)?;

    edit_member(&mut ir, "irVersion", JsonValue::String("one".to_owned()));
    let failures = check_strict_ir(&ir)?;

    assert!(
        failures.iter().any(|failure| matches!(
            failure,
            IrCheckFailure::Schema { pointer, .. } if pointer == "/irVersion"
        )),
        "failures {failures:?}"
    );

    Ok(())
}

#[test]
fn numbers_reach_the_validator_as_their_f64() -> TestResult {
    let value: JsonValue = serde_json::from_str("[1e-17, -0, 9007199254740993, 0.3, 404.0, 1e21]")?;
    let converted = serde_value_through_f64(&value)?;
    let texts: Vec<String> = converted
        .as_array()
        .map(|items| items.iter().map(ToString::to_string).collect())
        .unwrap_or_default();

    assert_eq!(
        texts,
        ["1e-17", "0", "9007199254740992.0", "0.3", "404", "1e+21"],
        "converted {converted}"
    );

    Ok(())
}
