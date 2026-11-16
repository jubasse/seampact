//! The pruning: references followed to a fixed point, identities as roots, core origins.

mod support;

use seampact_finalize::finalize_prune;
use seampact_json::JsonValue;
use serde_json::json;
use support::json;

type TestResult = Result<(), String>;

fn keys_of(ir: &JsonValue, member: &str) -> Vec<String> {
    match ir {
        JsonValue::Object(root) => match root.get(member) {
            Some(JsonValue::Object(entries)) => entries.keys().cloned().collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn operation_reading(schema: &str) -> serde_json::Value {
    json!({ "id": "op", "input": { "schema": { "kind": "ref", "schema": schema } } })
}

#[test]
fn an_unreferenced_schema_is_dropped_and_a_referenced_one_kept() -> TestResult {
    let mut ir = json(&json!({
        "schemas": { "Used": {}, "Unused": {} },
        "operations": [operation_reading("Used")]
    }))?;

    finalize_prune(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(keys_of(&ir, "schemas"), ["Used"]);

    Ok(())
}

#[test]
fn a_schema_referenced_by_a_kept_schema_is_kept() -> TestResult {
    let mut ir = json(&json!({
        "schemas": {
            "Outer": { "kind": "object", "properties": [{ "name": "inner", "schema": { "kind": "ref", "schema": "Inner" } }] },
            "Inner": {},
            "Other": {}
        },
        "operations": [operation_reading("Outer")]
    }))?;

    finalize_prune(&mut ir).map_err(|error| error.to_string())?;

    let kept = keys_of(&ir, "schemas");

    assert!(kept.contains(&"Outer".to_owned()), "kept {kept:?}");
    assert!(!kept.contains(&"Other".to_owned()), "kept {kept:?}");

    Ok(())
}

#[test]
fn an_identity_is_a_root_and_reaches_what_it_names() -> TestResult {
    let mut ir = json(&json!({
        "identities": { "session": { "kind": "credential", "errors": ["api.denied"] } },
        "errors": { "api.denied": {}, "api.other": {} }
    }))?;

    finalize_prune(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(keys_of(&ir, "identities"), ["session"]);
    assert_eq!(keys_of(&ir, "errors"), ["api.denied"]);

    Ok(())
}

#[test]
fn a_core_origin_keeps_the_entry_it_points_at() -> TestResult {
    let mut ir = json(&json!({
        "errors": { "api.rate_limited": {}, "api.other": {} },
        "schemas": {
            "ApiRateLimitedParams": { "kind": "object", "origin": { "layer": "core", "pointer": "/errors/api.rate_limited/params" } }
        },
        "operations": [operation_reading("ApiRateLimitedParams")]
    }))?;

    finalize_prune(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(keys_of(&ir, "errors"), ["api.rate_limited"]);

    Ok(())
}

#[test]
fn a_core_origin_naming_another_api_points_at_no_entry_of_this_one() -> TestResult {
    let mut ir = json(&json!({
        "errors": { "api.rate_limited": {} },
        "schemas": {
            "ApiRateLimitedParams": { "kind": "object", "origin": { "api": "other", "layer": "core", "pointer": "/errors/api.rate_limited/params" } }
        },
        "operations": [operation_reading("ApiRateLimitedParams")]
    }))?;

    finalize_prune(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(keys_of(&ir, "errors"), Vec::<String>::new());
    assert_eq!(keys_of(&ir, "schemas"), ["ApiRateLimitedParams"]);

    Ok(())
}
