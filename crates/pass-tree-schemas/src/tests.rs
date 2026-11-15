//! Unit tests of the ported bricks the fixtures do not pin: JavaScript key order, pointer
//! escaping, the reporter over a fake context, and the text the pattern and extension key
//! functions read by code point.

use seampact_ir::{ExtensionKey, ExtensionPrefix};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::testing::{HalfFixture, raw_api_from_json};

use crate::compile::TreeSchemasCompiler;
use crate::extensions::{
    extension_key_parts, tree_schemas_extension_slot, tree_schemas_has_extensions,
};
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

#[test]
fn an_extension_slot_groups_keys_by_prefix_and_keeps_a_proto_key_as_data() {
    let value = parsed(r#"{"x-acme-a":1,"x-other-__proto__":2,"x-acme-b":3,"plain":4}"#);
    let JsonValue::Object(object) = &value else {
        panic!("an object expected");
    };
    let slot = tree_schemas_extension_slot(object);
    let acme = slot
        .get(&ExtensionPrefix::new("acme".to_owned()))
        .expect("acme prefix");
    let other = slot
        .get(&ExtensionPrefix::new("other".to_owned()))
        .expect("other prefix");

    assert_eq!(slot.len(), 2);
    assert_eq!(acme.len(), 2);
    assert!(other.contains_key(&ExtensionKey::new("__proto__".to_owned())));
    assert!(tree_schemas_has_extensions(object));
    assert!(!tree_schemas_has_extensions(&JsonObject::new()));
}

#[test]
fn schema_problems_follow_the_javascript_key_order_of_the_mapping() {
    let mut fixture = HalfFixture::from_json(
        r#"{"schemas":{"Thing":{"type":"object","zeta":1,"10":2,"2":3,"codeName":"x"}}}"#,
    )
    .expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                .expect("compiler");

            compiler.compile_catalogue().expect("catalogue");
            compiler.reporter.into_reported()
        })
        .expect("context");
    let pointers: Vec<&str> = reported
        .iter()
        .map(|diagnostic| diagnostic.origin.pointer.as_str())
        .collect();

    assert_eq!(
        pointers,
        [
            "/schemas/Thing/2",
            "/schemas/Thing/10",
            "/schemas/Thing/zeta"
        ]
    );
}

#[test]
fn a_mark_on_a_declared_object_is_refused_in_written_order() {
    let mut fixture = HalfFixture::from_json(
        r#"{"schemas":{"Thing":{"type":"object","properties":{},"default":{},"codeName":"x"}}}"#,
    )
    .expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                .expect("compiler");

            compiler.compile_catalogue().expect("catalogue");
            compiler.reporter.into_reported()
        })
        .expect("context");
    let messages: Vec<&str> = reported
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();

    assert_eq!(
        messages,
        [
            "'codeName' sits on a property",
            "'default' sits on an optional property or an optional query field"
        ]
    );
}
