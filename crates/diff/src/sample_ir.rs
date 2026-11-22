//! A compiled contract the unit tests of the crate start from.

use std::fs;
use std::path::Path;

use seampact_ir::ContractIr;

/// The IR of the `ordering` api of the `no-change` diff fixture.
pub(crate) fn sample_ir() -> ContractIr {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/expected/diff/no-change/before/ir/ordering.json");
    let text = fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path:?}: {error}"));

    ContractIr::from_json_text(&text).unwrap_or_else(|error| panic!("{path:?}: {error}"))
}
