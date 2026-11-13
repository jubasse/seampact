//! `pointer_below`, `json_at_pointer`, `is_json_object` and `pipeline_origin`.

use seampact_json::JsonValue;
use seampact_pipeline::{
    is_json_list, is_json_object, json_at_pointer, pipeline_origin, pointer_below,
};

use super::raw_api::{api_origin, single_layer_api};

fn tree() -> JsonValue {
    serde_json::from_str(r#"{"a":{"b/c":[10,{"~":true}]},"list":[1,2]}"#).unwrap()
}

#[test]
fn pointer_below_appends_escaped_segments() {
    assert_eq!(pointer_below("/a", &[]), "/a");
    assert_eq!(pointer_below("", &["a", "b/c", "1"]), "/a/b~1c/1");
    assert_eq!(pointer_below("/x", &["~"]), "/x/~0");
}

#[test]
fn json_at_pointer_reads_members_and_unescapes_segments() {
    let tree = tree();

    assert_eq!(json_at_pointer(&tree, ""), Some(&tree));
    assert_eq!(
        json_at_pointer(&tree, "/a/b~1c/0"),
        Some(&serde_json::from_str("10").unwrap())
    );
    assert_eq!(
        json_at_pointer(&tree, "/a/b~1c/1/~0"),
        Some(&JsonValue::Bool(true))
    );
    // `~01` is the text `~1`, not a slash: the slash escape is undone first.
    let escaped: JsonValue = serde_json::from_str(r#"{"~1":1}"#).unwrap();

    assert!(json_at_pointer(&escaped, "/~01").is_some());
}

#[test]
fn json_at_pointer_names_nothing_for_a_missing_or_relative_pointer() {
    let tree = tree();

    assert_eq!(json_at_pointer(&tree, "/missing"), None);
    assert_eq!(json_at_pointer(&tree, "/constructor"), None);
    assert_eq!(json_at_pointer(&tree, "a"), None);
    assert_eq!(json_at_pointer(&tree, "/a/b~1c/x"), None);
}

#[test]
fn json_at_pointer_takes_a_canonical_array_index_only() {
    let tree = tree();

    assert!(json_at_pointer(&tree, "/list/1").is_some());

    for pointer in [
        "/list/01",
        "/list/-1",
        "/list/1.0",
        "/list/length",
        "/list/5",
        "/list/",
        "/list/99999999999999999999999",
    ] {
        assert_eq!(json_at_pointer(&tree, pointer), None, "{pointer}");
    }
}

#[test]
fn json_kind_tests_tell_an_object_from_a_list() {
    let object: JsonValue = serde_json::from_str("{}").unwrap();
    let list: JsonValue = serde_json::from_str("[]").unwrap();

    assert!(is_json_object(&object) && !is_json_list(&object));
    assert!(is_json_list(&list) && !is_json_object(&list));
    assert!(!is_json_object(&JsonValue::Null) && !is_json_object(&JsonValue::String("x".into())));
}

#[test]
fn origins_of_nodes_leaves_list_items_and_absent_pointers() {
    let raw = single_layer_api(
        r#"{"surfaces":{"app":{"identity":"user","tags":["app"]}},"a~b":{"c/d":1}}"#,
    );

    assert_eq!(
        pipeline_origin(&raw, "/surfaces/app/identity"),
        Some(api_origin("/surfaces/app/identity"))
    );
    assert_eq!(
        pipeline_origin(&raw, "/surfaces/app/tags/0"),
        Some(api_origin("/surfaces/app/tags/0"))
    );
    assert_eq!(
        pipeline_origin(&raw, "/a~0b/c~1d"),
        Some(api_origin("/a~0b/c~1d"))
    );
    assert_eq!(pipeline_origin(&raw, "/surfaces/app/nothing"), None);
    assert_eq!(pipeline_origin(&raw, "no-slash"), None);
}

#[test]
fn an_object_no_leaf_covers_takes_the_last_layer_that_writes_it() {
    use seampact_authoring::ApiLayer;
    use seampact_ir::Layer;

    let raw = super::raw_api::raw_api(&[
        (ApiLayer::Shared, r#"{"surfaces":{"app":{"identity":"a"}}}"#),
        (ApiLayer::Api, r#"{"surfaces":{"app":{"csrf":true}}}"#),
    ]);
    let origin = pipeline_origin(&raw, "/surfaces/app").unwrap();

    assert_eq!(origin.layer, Layer::Api);
    assert_eq!(origin.pointer, "/surfaces/app");
    assert_eq!(
        pipeline_origin(&raw, "/surfaces/app/identity")
            .unwrap()
            .layer,
        Layer::Shared
    );
}
