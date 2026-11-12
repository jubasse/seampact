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
use seampact_js::is_ecmascript_white_space;
use seampact_json::{JsonObject, JsonValue};

/// The list whose elements a delta keys by operation id; every other list's are keyed by index.
const OPERATIONS: &str = "operations";

/// The largest integer a JavaScript number holds exactly, as a float.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

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
            list_index_of_key(key, list.len())
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

/// The index `list[Number(key)]` reads in a list of `length` elements, if `Number(key)` is one.
///
/// `Number` reads the text after trimming ECMAScript white space: an empty text is 0, a `0x`,
/// `0o` or `0b` text is an unsigned integer, and any other text is a decimal literal with an
/// optional sign, fraction and exponent. `-0` is the index 0; `1.5`, `abc` and `Infinity` are no index.
fn list_index_of_key(key: &str, length: usize) -> Option<usize> {
    let number = js_number_of_text(key.trim_matches(is_ecmascript_white_space))?;

    if number.fract() != 0.0 || !(0.0..=MAX_SAFE_INTEGER).contains(&number) {
        return None;
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the number is a non-negative integer of at most 2^53, checked above"
    )]
    let position = number as u64;
    let position = usize::try_from(position).ok()?;

    (position < length).then_some(position)
}

fn js_number_of_text(text: &str) -> Option<f64> {
    if text.is_empty() {
        return Some(0.0);
    }

    for (prefixes, radix) in [(["0x", "0X"], 16), (["0o", "0O"], 8), (["0b", "0B"], 2)] {
        let digits = prefixes.iter().find_map(|prefix| text.strip_prefix(prefix));

        if let Some(digits) = digits {
            return unsigned_integer_of(digits, radix);
        }
    }

    let is_decimal_text = text.chars().all(|character| {
        character.is_ascii_digit() || matches!(character, '.' | 'e' | 'E' | '+' | '-')
    });

    if !is_decimal_text {
        return None;
    }

    text.parse::<f64>().ok()
}

fn unsigned_integer_of(digits: &str, radix: u32) -> Option<f64> {
    if digits.is_empty() || !digits.chars().all(|character| character.is_digit(radix)) {
        return None;
    }

    // A value past u64 is no list index: answer a number that no index check accepts.
    let value = u64::from_str_radix(digits, radix).ok()?;

    #[expect(
        clippy::cast_precision_loss,
        reason = "a value past 2^53 is refused by the index check whatever its low bits"
    )]
    Some(value as f64)
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
