//! The canonical order of the IR arrays, with the edge values of the JavaScript rows of PORTING
//! section 2: UTF-16 order, number comparison and text.

mod support;

use seampact_finalize::{finalize_canonical_order, finalize_sorted_array_rows};
use serde_json::json;
use support::{json, texts_at};

type TestResult = Result<(), String>;

fn operation_ids(ids: &[&str]) -> serde_json::Value {
    let operations: Vec<_> = ids.iter().map(|id| json!({ "id": id })).collect();

    json!({ "operations": operations })
}

#[test]
fn operations_sort_by_utf16_code_units_not_code_points() -> TestResult {
    // U+1F600 is the surrogate pair D83D DE00, so it sorts before U+E000 in JavaScript.
    let mut ir = json(&operation_ids(&["\u{E000}", "\u{1F600}", "b", "a"]))?;

    finalize_canonical_order(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(
        texts_at(&ir, &["operations"], "id"),
        ["a", "b", "\u{1F600}", "\u{E000}"]
    );

    Ok(())
}

#[test]
fn errors_sort_by_status_then_code_and_an_undeclared_code_last() -> TestResult {
    let mut ir = json(&json!({
        "errors": {
            "b": { "http": { "status": 404 } },
            "a": { "http": { "status": 404 } },
            "c": { "http": { "status": 400 } }
        },
        "operations": [{
            "id": "op",
            "errors": [{ "code": "zzz" }, { "code": "b" }, { "code": "a" }, { "code": "c" }]
        }]
    }))?;

    finalize_canonical_order(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(texts_at(&ir, &["operations"], "id"), ["op"],);
    let sorted = match &ir {
        seampact_json::JsonValue::Object(root) => root.get("operations").cloned(),
        _ => None,
    };
    let codes = match sorted {
        Some(seampact_json::JsonValue::Array(operations)) => match operations.first() {
            Some(operation) => texts_at(operation, &["errors"], "code"),
            None => Vec::new(),
        },
        _ => Vec::new(),
    };

    assert_eq!(codes, ["c", "a", "b", "zzz"]);

    Ok(())
}

#[test]
fn integers_above_2_pow_53_tie_as_numbers_and_order_by_their_bytes() -> TestResult {
    let mut ir = json(&json!({
        "lint": { "allows": [
            { "rule": "r", "subtree": 9_007_199_254_740_993_u64 },
            { "rule": "r", "subtree": 9_007_199_254_740_992_u64 },
            { "rule": "p", "subtree": 1 }
        ] }
    }))?;

    finalize_canonical_order(&mut ir).map_err(|error| error.to_string())?;

    let rules = texts_at(&ir, &["lint", "allows"], "rule");

    assert_eq!(rules, ["p", "r", "r"]);

    Ok(())
}

#[test]
fn an_integer_like_key_does_not_change_the_order_of_an_array() -> TestResult {
    let mut ir = json(&operation_ids(&["10", "9", "a"]))?;

    finalize_canonical_order(&mut ir).map_err(|error| error.to_string())?;

    assert_eq!(texts_at(&ir, &["operations"], "id"), ["10", "9", "a"]);

    Ok(())
}

#[test]
fn the_sorted_rows_are_the_rows_of_adr_0004_section_9() {
    let rows = finalize_sorted_array_rows();

    assert_eq!(rows.len(), 38);
    assert!(rows.contains(&"Operation.errors"));
    assert!(rows.contains(&"UnionSchema.variants"));
}

#[test]
fn sorting_twice_changes_nothing() -> TestResult {
    let mut once = json(&operation_ids(&["b", "\u{1F600}", "a"]))?;

    finalize_canonical_order(&mut once).map_err(|error| error.to_string())?;

    let mut twice = once.clone();

    finalize_canonical_order(&mut twice).map_err(|error| error.to_string())?;

    assert_eq!(twice, once);

    Ok(())
}
