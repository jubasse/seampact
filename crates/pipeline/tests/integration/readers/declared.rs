//! The declared catalogue entries and whether the contract reaches each.

use seampact_authoring::ApiLayer;
use seampact_ir::{ContractIr, Layer};
use seampact_pipeline::pipeline_declared;

use super::raw_api::raw_api;
use crate::support::repository_root;

// A finalized IR that holds the schemas `Note` and `Space`, the scheme `bearer` and the identity
// `user`.
fn notes_ir() -> ContractIr {
    let path = repository_root().join("fixtures/golden/bodies/notes.ir.json");

    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn every_catalogue_entry_is_listed_with_its_layer_pruned_or_not() {
    let raw = raw_api(&[
        (
            ApiLayer::Shared,
            r#"{"schemes":{"bearer":{"kind":"bearer"},"spare":{"kind":"bearer"}}}"#,
        ),
        (ApiLayer::Api, r#"{"schemas":{"Unused":{"type":"object"}}}"#),
    ]);
    let declared = pipeline_declared(&raw, &notes_ir()).unwrap();

    assert_eq!(
        declared
            .iter()
            .map(|entry| (
                entry.catalogue,
                entry.id.as_str(),
                entry.origin.layer.clone(),
                entry.reached
            ))
            .collect::<Vec<_>>(),
        [
            ("schemas", "Unused", Layer::Api, false),
            ("schemes", "bearer", Layer::Shared, true),
            ("schemes", "spare", Layer::Shared, false),
        ]
    );
}

#[test]
fn a_schema_inlined_at_its_uses_is_reached_through_a_reached_schema_and_a_route() {
    let raw = raw_api(&[(
        ApiLayer::Api,
        r#"{
          "schemas": {
            "NoteId": {"type": "string"},
            "RouteOnly": {"type": "string"},
            "Spare": {"type": "string"},
            "Note": {"type": "object", "properties": {"id": "NoteId"}}
          },
          "conventions": {"bodyLimit": "1MiB"},
          "surfaces": {"app": {"routes": {"notes": {"item": "RouteOnly"}}}}
        }"#,
    )]);
    let declared = pipeline_declared(&raw, &notes_ir()).unwrap();
    let reached: Vec<(&str, bool)> = declared
        .iter()
        .map(|entry| (entry.id.as_str(), entry.reached))
        .collect();

    assert_eq!(
        reached,
        [
            ("NoteId", true),
            ("RouteOnly", true),
            ("Spare", false),
            ("Note", true),
        ]
    );
}

#[test]
fn a_convention_value_naming_an_entry_reaches_it() {
    let raw = raw_api(&[(
        ApiLayer::Api,
        r#"{"errors":{"a.denied":{}},"conventions":{"errors":{"derived":{"forbidden":"a.denied"}}}}"#,
    )]);
    let declared = pipeline_declared(&raw, &notes_ir()).unwrap();

    assert_eq!(declared.len(), 1);
    assert!(declared[0].reached);
}
