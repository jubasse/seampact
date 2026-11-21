//! The typed support check finds what the JSON check finds in the IR's encoding.

use std::fs;

use seampact_ir::{ContractIr, IrSupport, check_contract_ir_support, check_ir_support};

/// A committed IR with operations, from the golden fixtures.
const FIXTURE_IR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/expected/golden/every-default/contract/ir/ledger.json"
);

const SUPPORT: IrSupport<'static> = IrSupport {
    ir_versions: &[1],
    ir_revision: 1,
    kinds: &["httpOperation"],
    features: &["paging"],
};

#[test]
fn the_typed_check_agrees_with_the_check_of_the_encoding() -> Result<(), Box<dyn std::error::Error>>
{
    let text = fs::read_to_string(FIXTURE_IR)?
        .replacen("\"kinds\": [", "\"kinds\": [\"graphQuery\", ", 1)
        .replacen("\"features\": []", "\"features\": [\"streaming\"]", 1);
    let ir = ContractIr::from_json_text(&text)?;
    let typed = check_contract_ir_support(&ir, &SUPPORT);

    assert!(
        typed.len() > 2,
        "the fixture should show several mismatches: {typed:?}"
    );
    assert_eq!(typed, check_ir_support(&ir.to_json_value()?, &SUPPORT));

    let mut other_version = ir;

    other_version.ir_version += 1;

    assert_eq!(
        check_contract_ir_support(&other_version, &SUPPORT),
        check_ir_support(&other_version.to_json_value()?, &SUPPORT)
    );

    Ok(())
}
