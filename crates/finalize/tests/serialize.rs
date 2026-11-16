//! The serialised IR: byte-stable, newline-ended, and a fixed point of its own reading.

use std::error::Error;
use std::fs;

use seampact_finalize::{finalize_canonical_ir, finalize_serialize_ir};
use seampact_ir::ContractIr;

type TestResult = Result<(), Box<dyn Error>>;

const FIXTURE_IR: &str = "../../fixtures/expected/reference/ir/tasksOptionalAuth.json";

#[test]
fn the_expected_ir_of_a_fixture_serialises_to_its_own_bytes() -> TestResult {
    let text = fs::read_to_string(FIXTURE_IR)?;
    let ir = ContractIr::from_json_text(&text)?;

    assert_eq!(finalize_serialize_ir(&ir)?, text);

    Ok(())
}

#[test]
fn the_canonical_ir_is_a_fixed_point_of_serialisation() -> TestResult {
    let ir = ContractIr::from_json_text(&fs::read_to_string(FIXTURE_IR)?)?;
    let canonical = finalize_canonical_ir(&ir)?;

    assert_eq!(
        finalize_serialize_ir(&canonical)?,
        finalize_serialize_ir(&ir)?
    );
    assert!(finalize_serialize_ir(&canonical)?.ends_with("}\n"));

    Ok(())
}
