//! Unit tests of the ported bricks the fixtures do not pin: JavaScript key order, pointer
//! escaping, the reporter over a fake context, and the text the pattern and extension key
//! functions read by code point.

use seampact_json::JsonValue;
use seampact_pipeline::testing::{HalfFixture, raw_api_from_json};

use crate::extensions::extension_key_parts;
use crate::pattern::tree_schemas_escape_pattern_literal;
use crate::raw::{
    TreeSchemasProblem, TreeSchemasReporter, tree_schemas_entries, tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

fn parsed(text: &str) -> JsonValue {
    let raw = raw_api_from_json(text).expect("test json");

    JsonValue::Object(raw.merged)
}

#[test]
fn entries_list_array_index_keys_first_then_written_order() {
    let value = parsed(r#"{"b":1,"10":2,"a":3,"9":4}"#);
    let keys: Vec<&str> = tree_schemas_entries(Some(&value))
        .into_iter()
        .map(|(key, _)| key)
        .collect();

    assert_eq!(keys, ["9", "10", "b", "a"]);
    assert_eq!(tree_schemas_entries(Some(&JsonValue::Null)).len(), 0);
    assert_eq!(tree_schemas_entries(None).len(), 0);
}

#[test]
fn a_pointer_escapes_tilde_before_slash_and_keeps_astral_text() {
    assert_eq!(
        tree_schemas_pointer("/schemas", &["a/b", "~1", "\u{1F600}"]),
        "/schemas/a~1b/~01/\u{1F600}"
    );
    assert_eq!(tree_schemas_pointer("/x", &[]), "/x");
    assert_eq!(tree_schemas_pointer("", &[""]), "/");
}

#[test]
fn a_literal_pattern_escapes_each_metacharacter_by_code_point() {
    assert_eq!(
        tree_schemas_escape_pattern_literal("a.b*(c)/\\\u{1F600}"),
        "a\\.b\\*\\(c\\)\\/\\\\\u{1F600}"
    );
    assert_eq!(tree_schemas_escape_pattern_literal(""), "");
}

#[test]
fn an_extension_key_needs_a_lowercase_prefix_and_a_one_line_key() {
    assert_eq!(extension_key_parts("x-acme-a-b"), Some(("acme", "a-b")));
    assert_eq!(extension_key_parts("x-a1-k"), Some(("a1", "k")));
    assert_eq!(extension_key_parts("x-1a-k"), None);
    assert_eq!(extension_key_parts("x-Acme-k"), None);
    assert_eq!(extension_key_parts("x-acme-"), None);
    assert_eq!(extension_key_parts("x-acme"), None);
    assert_eq!(extension_key_parts("x-acme-a\nb"), None);
    assert_eq!(extension_key_parts("x-acme-a\u{2028}"), None);
    assert_eq!(
        extension_key_parts("x-acme-\u{1F600}"),
        Some(("acme", "\u{1F600}"))
    );
}

#[test]
fn the_reporter_locates_a_problem_and_its_related_pointer() {
    let mut fixture = HalfFixture::from_json(r#"{"a":{"x":1},"b":2}"#).expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let mut reporter = TreeSchemasReporter::new(context);

            assert!(reporter.resolves("/a/x"));
            assert!(!reporter.resolves("/nope"));

            reporter
                .error(TreeSchemasProblem {
                    rule: TreeSchemasRule::NameCollision,
                    pointer: "/a/x".to_owned(),
                    message: "message".to_owned(),
                    fix: "fix".to_owned(),
                    related: Some(vec![crate::raw::TreeSchemasRelated {
                        pointer: "/b".to_owned(),
                        message: "other".to_owned(),
                    }]),
                })
                .expect("located");

            reporter.into_reported()
        })
        .expect("context");
    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(diagnostic.rule.as_str(), "seampact/tree/name-collision");
    assert_eq!(diagnostic.origin.pointer, "/a/x");
    assert_eq!(
        diagnostic
            .related
            .first()
            .map(|other| other.origin.pointer.as_str()),
        Some("/b")
    );
}

#[test]
fn a_pointer_naming_no_node_is_an_internal_error_and_reports_nothing() {
    let mut fixture = HalfFixture::from_json(r#"{"a":1}"#).expect("fixture");
    let failed = fixture
        .with_context(|context| {
            let mut reporter = TreeSchemasReporter::new(context);
            let result = reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::NameCollision,
                pointer: "/missing".to_owned(),
                message: String::new(),
                fix: String::new(),
                related: None,
            });

            (result.is_err(), reporter.into_reported().len())
        })
        .expect("context");

    assert_eq!(failed, (true, 0));
}
