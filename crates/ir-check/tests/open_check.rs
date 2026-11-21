//! The open check: unknown union tags and open-enum values are listed, not schema problems.

use std::error::Error;
use std::fs;

use seampact_ir_check::{IrCheckFailure, check_open_ir};
use seampact_json::JsonValue;

type TestResult = Result<(), Box<dyn Error>>;

const FIXTURE_IR: &str = "../../fixtures/expected/reference/ir/tasksOptionalAuth.json";

fn edited(pointer: &str, value: &str) -> Result<JsonValue, Box<dyn Error>> {
    let mut document: serde_json::Value = serde_json::from_str(&fs::read_to_string(FIXTURE_IR)?)?;

    *document
        .pointer_mut(pointer)
        .ok_or("the pointer names no member")? = serde_json::Value::String(value.to_owned());

    Ok(serde_json::from_value(document)?)
}

#[test]
fn a_real_ir_is_valid_and_lists_nothing() -> TestResult {
    let report = check_open_ir(&serde_json::from_str(&fs::read_to_string(FIXTURE_IR)?)?)?;

    assert!(report.valid, "report {report:?}");
    assert_eq!(report.failures, Vec::new());

    Ok(())
}

#[test]
fn an_unknown_kind_is_listed_and_no_schema_problem() -> TestResult {
    let report = check_open_ir(&edited("/api/version/kind", "future")?)?;

    assert_eq!(
        report.failures,
        vec![IrCheckFailure::UnknownKind {
            pointer: "/api/version".to_owned(),
            tag: "kind".to_owned(),
            value: "future".to_owned(),
        }],
        "report {report:?}"
    );

    Ok(())
}

#[test]
fn an_unknown_open_enum_value_is_listed() -> TestResult {
    let report = check_open_ir(&edited("/api/wire/outputEnums", "future")?)?;

    assert_eq!(
        report.failures,
        vec![IrCheckFailure::UnknownValue {
            pointer: "/api/wire/outputEnums".to_owned(),
            value: "future".to_owned(),
        }],
        "report {report:?}"
    );

    Ok(())
}
