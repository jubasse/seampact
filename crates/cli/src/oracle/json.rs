//! The JSON builders every oracle subject answers with, so no subject writes its own.

use seampact_json::{JsonNumber, JsonValue};

/// An integer as a JSON number.
pub(crate) fn integer(value: i64) -> JsonValue {
    JsonValue::Number(JsonNumber::from_i64(value))
}

/// The items as a JSON array, each built by `item_json`.
pub(crate) fn array_of<Item>(items: &[Item], item_json: impl Fn(&Item) -> JsonValue) -> JsonValue {
    JsonValue::Array(items.iter().map(item_json).collect())
}

/// Appends each optional text member that is present, in the order given.
pub(crate) fn push_present_texts<'name, 'text>(
    members: &mut Vec<(&'name str, JsonValue)>,
    optional_texts: impl IntoIterator<Item = (&'name str, Option<&'text str>)>,
) {
    for (name, value) in optional_texts {
        if let Some(text) = value {
            members.push((name, JsonValue::text(text)));
        }
    }
}

/// A coded problem (a refusal, a failure, a config problem): `code`, `message` and `fix`, then
/// each optional text member that is present, in the order given.
pub(crate) fn coded_problem_json<'name, 'text>(
    code: &str,
    message: &str,
    fix: &str,
    optional_texts: impl IntoIterator<Item = (&'name str, Option<&'text str>)>,
) -> JsonValue {
    let mut members = vec![
        ("code", JsonValue::text(code)),
        ("message", JsonValue::text(message)),
        ("fix", JsonValue::text(fix)),
    ];

    push_present_texts(&mut members, optional_texts);

    JsonValue::object(members)
}
