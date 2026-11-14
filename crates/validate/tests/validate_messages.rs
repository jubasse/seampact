//! Refused inline schema forms, the wording of messages, escaping of authored values, the
//! diagnostic cap and the key order of the "one key" message: cases no fixture records.

use std::error::Error;

use seampact_authoring::LayerSchemaKind;
use seampact_diagnostics::{Diagnostic, DiagnosticLayer};
use seampact_json::JsonValue;
use seampact_validate::{ValidateRule, validate_document};

type TestResult = Result<(), Box<dyn Error>>;

/// The cap of diagnostics one document gives.
const MAX_DIAGNOSTICS: usize = 200;

fn diagnostics_of(
    kind: LayerSchemaKind,
    json: &serde_json::Value,
) -> Result<Vec<Diagnostic>, Box<dyn Error>> {
    let tree = JsonValue::try_from(json.clone())?;

    Ok(validate_document(kind, &tree, &DiagnosticLayer::Shared)?)
}

fn only_diagnostic(
    kind: LayerSchemaKind,
    json: &serde_json::Value,
) -> Result<Diagnostic, Box<dyn Error>> {
    let mut found = diagnostics_of(kind, json)?;

    assert_eq!(found.len(), 1, "{found:?}");

    found.pop().ok_or_else(|| "no diagnostic".into())
}

fn schema_in_base(schema: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "schemas": { "T": schema } })
}

#[test]
fn a_refused_inline_schema_form_is_one_refused_keyword() -> TestResult {
    let cases = [
        (
            "a type array",
            serde_json::json!({ "type": ["string", "null"] }),
            "type",
        ),
        ("type null", serde_json::json!({ "type": "null" }), "type"),
        (
            "an inline enum",
            serde_json::json!({ "enum": ["open", "done"] }),
            "enum",
        ),
        (
            "additionalProperties false",
            serde_json::json!({ "type": "object", "properties": { "a": { "type": "string" } }, "additionalProperties": false }),
            "additionalProperties",
        ),
    ];

    for (name, schema, keyword) in cases {
        let found = diagnostics_of(LayerSchemaKind::Base, &schema_in_base(schema))?;
        let [only] = found.as_slice() else {
            return Err(format!("{name}: {found:?}").into());
        };

        assert_eq!(only.rule, ValidateRule::RefusedKeyword.rule_id(), "{name}");
        assert_eq!(
            only.origin.pointer,
            format!("/schemas/T/{keyword}"),
            "{name}"
        );
    }

    Ok(())
}

fn node_in_api(node: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "api": { "name": "tasks", "version": 1 },
        "surfaces": { "app": { "routes": { "health": node } } }
    })
}

fn node_message(node: serde_json::Value) -> Result<String, Box<dyn Error>> {
    Ok(only_diagnostic(LayerSchemaKind::Api, &node_in_api(node))?.message)
}

#[test]
fn messages_name_the_problem_without_ajv_wording() -> TestResult {
    let cases = [
        (
            serde_json::json!({ "method": "get", "paging": 3 }),
            "'paging' must be a string or a mapping.",
        ),
        (
            serde_json::json!({ "method": "get", "concurrency": "own" }),
            "'concurrency' is 'own'; its one value is \"inherit\".",
        ),
        (
            serde_json::json!({ "method": "get", "paging": { "cursor": {}, "offset": {} } }),
            "'paging' takes one key, not 'cursor', 'offset'.",
        ),
        (
            serde_json::json!({ "method": "get", "paging": { "$include": "./p.yaml", "cursor": {}, "offset": {} } }),
            "'paging' takes one key, not 'cursor', 'offset'.",
        ),
    ];

    for (node, expected) in cases {
        let message = node_message(node.clone())?;

        assert_eq!(message, expected, "{node}");
        assert!(
            !["must NOT", "equal to constant", "must match"]
                .iter()
                .any(|ajv| message.contains(ajv)),
            "{message}"
        );
    }

    Ok(())
}

#[test]
fn a_control_bidi_or_separator_character_is_escaped() -> TestResult {
    let key = "a\u{1b}[31mred\u{202e}b\u{2028}c\nd";
    let found = only_diagnostic(
        LayerSchemaKind::Api,
        &node_in_api(serde_json::json!({ "method": "get", key: 1 })),
    )?;

    assert!(
        found
            .message
            .contains("'a\\u001B[31mred\\u202Eb\\u2028c\\u000Ad'"),
        "{}",
        found.message
    );
    assert!(
        !found
            .fix
            .chars()
            .any(|c| ['\u{1b}', '\n', '\u{202e}', '\u{2028}'].contains(&c)),
        "{}",
        found.fix
    );

    Ok(())
}

#[test]
fn a_long_value_is_cut_and_gets_no_closest_keyword() -> TestResult {
    let key = format!("ouput{}", "x".repeat(200));
    let found = only_diagnostic(
        LayerSchemaKind::Api,
        &node_in_api(serde_json::json!({ "method": "get", key: 1 })),
    )?;

    assert!(found.message.chars().count() < 140, "{}", found.message);
    assert!(found.message.contains('\u{2026}'), "{}", found.message);
    assert!(found.fix.starts_with("Remove '"), "{}", found.fix);

    Ok(())
}

#[test]
fn a_value_in_an_enum_message_is_quoted_and_escaped() -> TestResult {
    let message = node_message(serde_json::json!({ "method": "ge\u{7}t" }))?;

    assert_eq!(message, "'method' is 'ge\\u0007t', not one of its values.");

    Ok(())
}

#[test]
fn a_file_far_from_the_grammar_gives_at_most_the_cap() -> TestResult {
    let mut node = serde_json::Map::new();

    node.insert("method".to_owned(), serde_json::json!("get"));

    for index in 0..500 {
        node.insert(format!("k{index}"), serde_json::json!(index));
    }

    let found = diagnostics_of(
        LayerSchemaKind::Api,
        &node_in_api(serde_json::Value::Object(node)),
    )?;

    assert_eq!(found.len(), MAX_DIAGNOSTICS);

    Ok(())
}

#[test]
fn the_one_key_message_lists_keys_in_javascript_order() -> TestResult {
    let tree = node_in_api(serde_json::from_str(
        r#"{ "method": "get", "paging": { "offset": {}, "cursor": {}, "7": {} } }"#,
    )?);
    let found = diagnostics_of(LayerSchemaKind::Api, &tree)?;
    let conflicting: Vec<&str> = found
        .iter()
        .filter(|d| d.rule == ValidateRule::ConflictingKeywords.rule_id())
        .map(|d| d.message.as_str())
        .collect();

    assert_eq!(
        conflicting,
        ["'paging' takes one key, not '7', 'offset', 'cursor'."]
    );

    Ok(())
}
