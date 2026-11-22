//! The rule that an opaque value of a scalar use is exact: `int64` and `decimal` are strings.

use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, stringify_json};

use super::violation::{IrInvariantId, Violations};

/// The largest integer a JavaScript number holds exactly, 2^53 - 1.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

// `-?(0|[1-9][0-9]*)`.
fn is_integer_text(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);

    match digits.as_bytes() {
        [b'0'] => true,
        [first, rest @ ..] => {
            first.is_ascii_digit() && *first != b'0' && rest.iter().all(u8::is_ascii_digit)
        }
        [] => false,
    }
}

// `-?(0|[1-9][0-9]*)(\.[0-9]+)?`.
fn is_decimal_text(text: &str) -> bool {
    match text.split_once('.') {
        Some((whole, fraction)) => {
            is_integer_text(whole)
                && !fraction.is_empty()
                && fraction.bytes().all(|digit| digit.is_ascii_digit())
        }
        None => is_integer_text(text),
    }
}

fn is_safe_integer(number: f64) -> bool {
    number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER
}

// Why an opaque value breaks the rule for its scalar use, if it does. A value of another JSON
// type is the example check's to refuse, and nested values are not checked.
fn inexact_number(type_use: &JsonObject, value: &JsonValue) -> Option<String> {
    if !is_text(type_use.get("kind"), "scalar") || matches!(value, JsonValue::Null) {
        return None;
    }

    let format = type_use.get("format");

    if is_text(format, "int64") || is_text(format, "decimal") {
        return inexact_text_number(&js_text_of(format), value);
    }

    let JsonValue::Number(number) = value else {
        return None;
    };

    if is_text(type_use.get("type"), "integer") && !is_safe_integer(number.to_f64()) {
        return Some(format!(
            "The integer value {} is no safe integer: write a larger one as an int64.",
            js_text_of(Some(value))
        ));
    }

    None
}

fn inexact_text_number(format: &str, value: &JsonValue) -> Option<String> {
    let is_int64 = format == "int64";
    let JsonValue::String(text) = value else {
        return Some(not_a_string_form(format, value));
    };
    let well_formed = if is_int64 {
        is_integer_text(text)
    } else {
        is_decimal_text(text)
    };

    if !well_formed {
        return Some(not_a_string_form(format, value));
    }

    if is_int64 && (text == "-0" || text.parse::<i64>().is_err()) {
        return Some(format!(
            "The int64 value '{text}' is -0 or outside -2^63 to 2^63 - 1."
        ));
    }

    None
}

fn not_a_string_form(format: &str, value: &JsonValue) -> String {
    format!(
        "An {format} value is its string form, not {}.",
        stringify_json(value)
    )
}

/// The values a member holds for its type use: `default` and each of `examples`, with their
/// pointers.
pub(super) fn check_exact_numbers(
    type_use: Option<&JsonObject>,
    default: Option<&JsonValue>,
    examples: Option<&JsonValue>,
    pointer: &str,
    out: &mut Violations,
) {
    let Some(type_use) = type_use else {
        return;
    };
    let mut values: Vec<(String, &JsonValue)> = Vec::new();

    if let Some(default) = default {
        values.push((format!("{pointer}/default"), default));
    }

    for (index, example) in items_of(examples).iter().enumerate() {
        values.push((format!("{pointer}/examples/{index}"), example));
    }

    for (at, value) in values {
        if let Some(problem) = inexact_number(type_use, value) {
            out.fail(IrInvariantId::ValueExactNumber, &at, problem);
        }
    }
}
