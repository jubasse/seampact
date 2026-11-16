//! A schema answers its origin whatever its kind, and refuses a kind it does not know.

use seampact_ir::{ContractIr, Schema};

/// The IR example that holds an object, a map and a union schema.
const EVERY_MEMBER_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/every-member.ir.json");

#[test]
fn every_known_schema_kind_answers_the_origin_it_declares() {
    let ir = ContractIr::from_json_text(EVERY_MEMBER_EXAMPLE).unwrap();
    let mut kinds: Vec<String> = Vec::new();

    for schema in ir.schemas.values() {
        let origin = schema.origin().unwrap();
        let written = serde_json::to_value(schema).unwrap();

        assert_eq!(
            serde_json::to_value(origin).unwrap(),
            written["origin"],
            "schema {written}"
        );
        kinds.push(written["kind"].as_str().unwrap().to_owned());
    }

    kinds.sort();
    kinds.dedup();

    assert_eq!(kinds, ["map", "object", "union"]);
}

#[test]
fn a_schema_of_an_unknown_kind_has_no_origin() {
    let schema: Schema = serde_json::from_str(r#"{"kind": "tuple", "id": "Pair"}"#).unwrap();
    let failure = schema.origin().unwrap_err();

    assert!(failure.to_string().contains("tuple"), "{failure}");
}
