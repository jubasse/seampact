//! The authored-key defences of the trees the loader builds.
//!
//! The trees hold keys an author wrote. The three names that reach a JavaScript object's
//! prototype are refused before they become keys (`seampact/load/reserved-key`), as they are in
//! the diagnostics the fixtures hold. The rest of the TypeScript defences (a prototype-less object,
//! own-property reads, defined keys, the deep copy) are what [`JsonObject`] and `Clone` already
//! do.

use seampact_json::{JsonObject, JsonValue, write_json_string};

/// Keys refused wherever an author writes one (`seampact/load/reserved-key`).
pub const RESERVED_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// Whether `key` is one of the [`RESERVED_KEYS`].
#[must_use]
pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key)
}

/// For messages: a value as its author would recognise it, whatever its type; a string as it is,
/// any other value as `JSON.stringify` writes it, an absent value as `nothing`.
#[must_use]
pub fn show_value(value: Option<&JsonValue>) -> String {
    match value {
        None => "nothing".to_owned(),
        Some(JsonValue::String(text)) => text.clone(),
        Some(other) => {
            let mut written = String::new();

            write_compact(&mut written, other);

            written
        }
    }
}

fn write_compact(output: &mut String, value: &JsonValue) {
    match value {
        JsonValue::Null => output.push_str("null"),
        JsonValue::Bool(flag) => output.push_str(if *flag { "true" } else { "false" }),
        JsonValue::Number(number) => output.push_str(&number.to_string()),
        JsonValue::String(text) => write_json_string(output, text),
        JsonValue::Array(items) => write_compact_array(output, items),
        JsonValue::Object(members) => write_compact_object(output, members),
    }
}

fn write_compact_array(output: &mut String, items: &[JsonValue]) {
    output.push('[');

    for (position, item) in items.iter().enumerate() {
        if position > 0 {
            output.push(',');
        }

        write_compact(output, item);
    }

    output.push(']');
}

fn write_compact_object(output: &mut String, members: &JsonObject) {
    output.push('{');

    for (position, (name, member)) in members.iter().enumerate() {
        if position > 0 {
            output.push(',');
        }

        write_json_string(output, name);
        output.push(':');
        write_compact(output, member);
    }

    output.push('}');
}
