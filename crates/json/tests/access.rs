//! Reading a value by its kind, and the members of an object by their kind.

use seampact_json::{JsonObject, JsonValue, is_text, items_of, object_of, text_of};

fn sample() -> JsonObject {
    JsonObject::from_members([
        ("object", JsonValue::Object(JsonObject::new())),
        ("list", JsonValue::Array(vec![JsonValue::Null])),
        ("text", JsonValue::text("a")),
        ("null", JsonValue::Null),
    ])
}

#[test]
fn a_value_reads_only_as_its_own_kind() {
    let object = sample();

    assert!(object_of(object.get("object")).is_some());
    assert!(object_of(object.get("list")).is_none());
    assert!(object_of(object.get("null")).is_none());
    assert!(object_of(None).is_none());
    assert_eq!(items_of(object.get("list")), [JsonValue::Null]);
    assert_eq!(items_of(object.get("text")), []);
    assert_eq!(items_of(None), []);
    assert_eq!(text_of(object.get("text")), Some("a"));
    assert_eq!(text_of(object.get("list")), None);
    assert!(is_text(object.get("text"), "a"));
    assert!(!is_text(object.get("text"), "b"));
    assert!(!is_text(None, "a"));
}

#[test]
fn a_member_reads_only_as_its_own_kind() {
    let object = sample();

    assert!(object.object_member("object").is_some());
    assert!(object.object_member("list").is_none());
    assert_eq!(object.array_member("list"), [JsonValue::Null]);
    assert_eq!(object.array_member("absent"), []);
    assert_eq!(object.text_member("text"), Some("a"));
    assert_eq!(object.text_member("object"), None);
}
