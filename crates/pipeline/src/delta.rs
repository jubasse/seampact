//! The draft delta convention: how a half's members are written and read back.
//!
//! [`draft_apply`] adds a half's members to a draft written as JSON, and [`draft_delta`] is its
//! inverse: the members a half wrote, from the draft before and after it. An absent member is
//! written whole, an object is described member by member, a list that grew is the appended
//! items, and a list whose elements changed is an object keyed by operation id under
//! `operations` and by index elsewhere (a key that names no element yet is appended when it is the
//! next index, or, under `operations`, the id the new element carries). A member already set is
//! never replaced.

use seampact_diagnostics::InternalError;
use seampact_js::list_index_of_number_text;
use seampact_json::{JsonObject, JsonValue};

/// The list whose elements a delta keys by operation id; every other list's are keyed by index.
const OPERATIONS: &str = "operations";

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

/// Adds a half's members to a draft: an absent member is set, an object is merged member by
/// member, a list is appended to, and an object over a list names the elements it merges into.
///
/// # Errors
///
/// An [`InternalError`] naming the path when `draft` is no object, when a member is already set
/// (a half adds members, never replaces one), when an object lands on a list without naming an
/// element, or when a key names no element and is not the next one.
pub fn draft_apply(draft: &mut JsonValue, members: &JsonObject) -> Result<(), InternalError> {
    let JsonValue::Object(target) = draft else {
        return Err(InternalError::new("draft_apply: the draft is no object"));
    };

    merge_object(target, members, "")
}

fn merge_object(
    target: &mut JsonObject,
    members: &JsonObject,
    path: &str,
) -> Result<(), InternalError> {
    for (key, value) in members {
        let at = join(path, key);

        let Some(present) = target.get_mut(key) else {
            target.insert(key.clone(), value.clone());

            continue;
        };

        match (present, value) {
            (JsonValue::Array(list), value) => merge_list(list, value, &at)?,
            (JsonValue::Object(object), JsonValue::Object(members)) => {
                merge_object(object, members, &at)?;
            }
            _ => {
                return Err(InternalError::new(format!(
                    "draft_apply: {at} is already set; a half adds members, never replaces one"
                )));
            }
        }
    }

    Ok(())
}

fn merge_list(
    list: &mut Vec<JsonValue>,
    value: &JsonValue,
    path: &str,
) -> Result<(), InternalError> {
    let items = match value {
        JsonValue::Array(items) => {
            list.extend(items.iter().cloned());

            return Ok(());
        }
        JsonValue::Object(items) => items,
        _ => {
            return Err(InternalError::new(format!(
                "draft_apply: {path} is a list; a half appends a list or merges an object"
            )));
        }
    };

    for (key, members) in items {
        let position = if path == OPERATIONS {
            operation_position(list, key)
        } else {
            list_index_of_number_text(key, list.len())
        };

        let Some(position) = position else {
            if is_next_element(list.len(), path, key, members) {
                list.push(members.clone());

                continue;
            }

            return Err(names_no_element(path, key));
        };

        let (Some(JsonValue::Object(element)), JsonValue::Object(members)) =
            (list.get_mut(position), members)
        else {
            return Err(names_no_element(path, key));
        };

        merge_object(element, members, &join(path, key))?;
    }

    Ok(())
}

fn names_no_element(path: &str, key: &str) -> InternalError {
    InternalError::new(format!(
        "draft_apply: {} names no element to merge an object into",
        join(path, key)
    ))
}

// A key naming no element yet: the next index of a list, or under `operations` the id the new
// element carries.
fn is_next_element(length: usize, path: &str, key: &str, members: &JsonValue) -> bool {
    if path == OPERATIONS {
        return matches!(
            members,
            JsonValue::Object(object)
                if matches!(object.get("id"), Some(JsonValue::String(id)) if id == key)
        );
    }

    key == length.to_string()
}

fn operation_position(operations: &[JsonValue], id: &str) -> Option<usize> {
    operations.iter().position(|operation| {
        matches!(
            operation,
            JsonValue::Object(object)
                if matches!(object.get("id"), Some(JsonValue::String(found)) if found == id)
        )
    })
}

/// The members a half wrote, in the convention [`draft_apply`] reads (its inverse): `before` is
/// the draft before the half, `after` the draft after it.
///
/// # Errors
///
/// An [`InternalError`] naming the path when either value is no object, or for a change the
/// convention cannot say: a member removed, a list that lost an element, a value replaced, or an
/// operation with no string `id`.
pub fn draft_delta(before: &JsonValue, after: &JsonValue) -> Result<JsonObject, InternalError> {
    let (JsonValue::Object(before), JsonValue::Object(after)) = (before, after) else {
        return Err(InternalError::new("draft_delta: a draft is an object"));
    };

    Ok(object_delta(before, after, "")?.unwrap_or_default())
}

fn object_delta(
    before: &JsonObject,
    after: &JsonObject,
    path: &str,
) -> Result<Option<JsonObject>, InternalError> {
    let mut delta = JsonObject::new();

    for key in before.keys() {
        if !after.contains_key(key) {
            return Err(InternalError::new(format!(
                "draft_delta: {} was removed; a half adds members only",
                join(path, key)
            )));
        }
    }

    for (key, member) in after {
        let at = join(path, key);

        let Some(present) = before.get(key) else {
            delta.insert(key.clone(), member.clone());

            continue;
        };

        if let Some(change) = member_delta(present, member, &at)? {
            delta.insert(key.clone(), change);
        }
    }

    Ok((!delta.is_empty()).then_some(delta))
}

fn member_delta(
    before: &JsonValue,
    after: &JsonValue,
    path: &str,
) -> Result<Option<JsonValue>, InternalError> {
    match (before, after) {
        (JsonValue::Array(before), JsonValue::Array(after)) => list_delta(before, after, path),
        (JsonValue::Object(before), JsonValue::Object(after)) => {
            Ok(object_delta(before, after, path)?.map(JsonValue::Object))
        }
        _ if before == after => Ok(None),
        _ => Err(InternalError::new(format!(
            "draft_delta: {path} was replaced; a half adds members, never replaces one"
        ))),
    }
}

fn list_delta(
    before: &[JsonValue],
    after: &[JsonValue],
    path: &str,
) -> Result<Option<JsonValue>, InternalError> {
    let mut edits = JsonObject::new();

    for (index, element) in before.iter().enumerate() {
        let Some(change) = element_delta(element, after.get(index), path, index)? else {
            continue;
        };

        edits.insert(
            element_key(element, path, index)?,
            JsonValue::Object(change),
        );
    }

    let appended: Vec<&JsonValue> = after.iter().skip(before.len()).collect();

    if !appended.is_empty() && edits.is_empty() {
        return Ok(Some(JsonValue::Array(
            appended.into_iter().cloned().collect(),
        )));
    }

    // Edits and appended elements together: an object, the appended elements keyed as the next elements.
    for (offset, element) in appended.into_iter().enumerate() {
        let key = element_key(element, path, before.len() + offset)?;

        edits.insert(key, element.clone());
    }

    Ok((!edits.is_empty()).then_some(JsonValue::Object(edits)))
}

// The key of a list element in an edits object: its id under `operations`, its index elsewhere.
fn element_key(element: &JsonValue, path: &str, index: usize) -> Result<String, InternalError> {
    if path == OPERATIONS {
        return operation_id_of(element, path, index);
    }

    Ok(index.to_string())
}

// A list that lost an element reports it here: the missing `after` element reads as a replaced one.
fn element_delta(
    before: &JsonValue,
    after: Option<&JsonValue>,
    path: &str,
    index: usize,
) -> Result<Option<JsonObject>, InternalError> {
    let at = join(path, &index.to_string());

    match (before, after) {
        (JsonValue::Object(before), Some(JsonValue::Object(after))) => {
            object_delta(before, after, &at)
        }
        (_, Some(after)) if before == after => Ok(None),
        _ => Err(InternalError::new(format!(
            "draft_delta: {at} was replaced or lost; a half adds members only"
        ))),
    }
}

fn operation_id_of(element: &JsonValue, path: &str, index: usize) -> Result<String, InternalError> {
    match element {
        JsonValue::Object(object) => match object.get("id") {
            Some(JsonValue::String(id)) => Ok(id.clone()),
            _ => Err(no_operation_id(path, index)),
        },
        _ => Err(no_operation_id(path, index)),
    }
}

fn no_operation_id(path: &str, index: usize) -> InternalError {
    InternalError::new(format!(
        "draft_delta: {} has no operation id",
        join(path, &index.to_string())
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn value(raw: serde_json::Value) -> JsonValue {
        JsonValue::try_from(raw).unwrap()
    }

    fn object(raw: serde_json::Value) -> JsonObject {
        match value(raw) {
            JsonValue::Object(object) => object,
            other => panic!("not an object: {other:?}"),
        }
    }

    fn applied(
        draft: serde_json::Value,
        members: serde_json::Value,
    ) -> Result<JsonValue, InternalError> {
        let mut draft = value(draft);

        draft_apply(&mut draft, &object(members))?;

        Ok(draft)
    }

    #[test]
    fn apply_sets_absent_members_and_appends_lists() {
        let got = applied(
            json!({"apis": [{"id": "a"}], "kinds": {}}),
            json!({"apis": [{"id": "b"}], "tree": {"nodes": []}}),
        )
        .unwrap();

        let want = value(json!({
            "apis": [{"id": "a"}, {"id": "b"}],
            "kinds": {},
            "tree": {"nodes": []},
        }));

        assert_eq!(got, want);
    }

    #[test]
    fn apply_orders_keys_as_javascript_does() {
        let got = applied(json!({}), json!({"b": 1, "a": 2, "10": 3, "9": 4})).unwrap();

        let JsonValue::Object(object) = got else {
            panic!("not an object");
        };
        let keys: Vec<&str> = object.keys().map(String::as_str).collect();

        // JavaScript order: integer keys ascending, then the others as inserted.
        assert_eq!(keys, ["9", "10", "b", "a"]);
    }

    #[test]
    fn apply_refuses_to_replace_a_member() {
        let error = applied(json!({"a": {"b": 1}}), json!({"a": {"b": 2}})).unwrap_err();

        assert!(error.to_string().contains("a.b is already set"), "{error}");
    }

    #[test]
    fn apply_refuses_a_draft_that_is_no_object() {
        let mut draft = value(json!([]));

        assert!(draft_apply(&mut draft, &object(json!({}))).is_err());
    }

    #[test]
    fn apply_merges_operations_by_id_and_appends_a_new_id() {
        let got = applied(
            json!({"operations": [{"id": "x"}]}),
            json!({"operations": {"x": {"summary": "s"}, "y": {"id": "y"}}}),
        )
        .unwrap();

        let want = value(json!({"operations": [{"id": "x", "summary": "s"}, {"id": "y"}]}));

        assert_eq!(got, want);
    }

    #[test]
    fn apply_refuses_an_operation_key_that_matches_no_id() {
        let error = applied(
            json!({"operations": [{"id": "x"}]}),
            json!({"operations": {"z": {"id": "other"}}}),
        )
        .unwrap_err();

        assert!(
            error.to_string().contains("operations.z names no element"),
            "{error}"
        );
    }

    #[test]
    fn apply_refuses_an_object_over_a_list_with_a_scalar_member() {
        assert!(applied(json!({"l": [1]}), json!({"l": 3})).is_err());
        assert!(applied(json!({"l": [1]}), json!({"l": {"0": {"a": 1}}})).is_err());
    }

    #[test]
    fn apply_appends_the_next_index_and_refuses_a_gap() {
        let got = applied(json!({"l": [{"a": 1}]}), json!({"l": {"1": {"b": 2}}})).unwrap();

        assert_eq!(got, value(json!({"l": [{"a": 1}, {"b": 2}]})));
        assert!(applied(json!({"l": [{"a": 1}]}), json!({"l": {"2": {"b": 2}}})).is_err());
    }

    #[test]
    fn apply_reads_a_list_key_as_javascript_number_does() {
        let indexed = [
            "0",
            "00",
            "+0",
            "-0",
            "0x0",
            "0X0",
            "0b0",
            "0o0",
            "0.0",
            "0e0",
            "",
            " ",
            " 0 ",
            "\u{feff}0",
            "\u{85}0\u{a0}",
        ];

        for key in indexed {
            let draft = json!({"l": [{"a": 1}]});
            let members = json!({"l": {key: {"b": 2}}});

            let got = applied(draft, members);
            let want = value(json!({"l": [{"a": 1, "b": 2}]}));

            // U+0085 is not ECMAScript white space: that key names no element.
            if key.contains('\u{85}') {
                assert!(got.is_err(), "key {key:?}");
            } else {
                assert_eq!(got.unwrap(), want, "key {key:?}");
            }
        }
    }

    #[test]
    fn apply_refuses_a_list_key_that_is_no_index() {
        for key in [
            "1.5",
            "abc",
            "Infinity",
            "-1",
            "0x",
            "1e999",
            "9007199254740993",
            "0xffffffffffffffffff",
        ] {
            let got = applied(json!({"l": [{"a": 1}]}), json!({"l": {key: {"b": 2}}}));

            assert!(got.is_err(), "key {key:?}");
        }
    }

    fn assert_inverse(before: serde_json::Value, members: serde_json::Value) {
        let before = value(before);
        let members = object(members);

        let mut after = before.clone();
        draft_apply(&mut after, &members).unwrap();

        assert_eq!(draft_delta(&before, &after).unwrap(), members);
    }

    #[test]
    fn delta_is_the_inverse_of_apply() {
        assert_inverse(json!({}), json!({"a": {"b": 1}}));
        assert_inverse(json!({"l": [1]}), json!({"l": [2, 3]}));
        assert_inverse(json!({"a": {"b": 1}}), json!({"a": {"c": 2}}));
        assert_inverse(
            json!({"operations": [{"id": "x"}]}),
            json!({"operations": {"x": {"summary": "s"}}}),
        );
        assert_inverse(
            json!({"l": [{"a": 1}]}),
            json!({"l": {"0": {"b": 2}, "1": {"c": 3}}}),
        );
    }

    #[test]
    fn delta_of_equal_drafts_is_empty() {
        let draft = value(json!({"a": [1, {"b": 2}]}));

        assert!(draft_delta(&draft, &draft).unwrap().is_empty());
    }

    #[test]
    fn delta_refuses_what_the_convention_cannot_say() {
        let refused = [
            (json!({"a": 1}), json!({})),
            (json!({"a": 1}), json!({"a": 2})),
            (json!({"a": {"b": 1}}), json!({"a": [1]})),
            (json!({"a": [1, 2]}), json!({"a": [1]})),
            (json!({"a": [1]}), json!({"a": [2]})),
            (
                json!({"operations": [{"id": "x"}]}),
                json!({"operations": []}),
            ),
            (
                json!({"operations": [{"id": "x"}]}),
                json!({"operations": [{"id": "x", "s": 1}, {"s": 2}]}),
            ),
            (
                json!({"operations": [{"s": 1}]}),
                json!({"operations": [{"s": 1, "t": 2}]}),
            ),
        ];

        for (before, after) in refused {
            let result = draft_delta(&value(before.clone()), &value(after.clone()));

            assert!(result.is_err(), "{before} -> {after}");
        }
    }

    #[test]
    fn delta_refuses_a_draft_that_is_no_object() {
        assert!(draft_delta(&value(json!([])), &value(json!({}))).is_err());
        assert!(draft_delta(&value(json!({})), &value(json!(1))).is_err());
    }

    #[test]
    fn delta_writes_appended_operations_whole_without_an_id() {
        let before = value(json!({"operations": []}));
        let after = value(json!({"operations": [{"s": 1}]}));

        let got = draft_delta(&before, &after).unwrap();

        assert_eq!(got, object(json!({"operations": [{"s": 1}]})));
    }
}
