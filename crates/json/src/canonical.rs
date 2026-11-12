//! The text of a JSON value: the IR and source-map bytes, the compact key of a value, and the
//! indented text of a value in its own member order.

use seampact_js::{cmp_utf16, js_key_order};

use crate::{JsonNumber, JsonObject, JsonValue};

/// The indentation of one nesting level in a canonical document.
const INDENT: &str = "  ";

/// How members and items are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Layout {
    /// `JSON.stringify(value)`: no white space.
    Compact,
    /// `JSON.stringify(value, null, 2)`: one member or item per line, two spaces per level.
    Indented,
}

/// The order members are written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemberOrder {
    /// UTF-16 code-unit order of the names, written as text (the IR's order, RFC 8785's).
    Utf16,
    /// UTF-16 order rebuilt into an object: array-index keys move first, as `Object.fromEntries`
    /// then `JSON.stringify` writes them.
    Utf16RebuiltAsObject,
    /// The object's own order: JavaScript's own-key order, as `JSON.stringify` walks an object.
    OwnKeys,
}

/// Which text a number is written as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NumberText {
    /// The number as written: an integer above 2^53 keeps its exact digits.
    Written,
    /// The ECMAScript text of the `f64` JavaScript holds: an integer above 2^53 is rounded.
    AsJavaScriptHolds,
}

/// Everything that distinguishes one canonical writer from the other.
#[derive(Debug, Clone, Copy)]
struct Format {
    layout: Layout,
    order: MemberOrder,
    numbers: NumberText,
}

/// The IR file text of a value: every object's members sorted by the UTF-16 code units of their
/// names, two-space indentation, LF line endings and a final newline.
///
/// Strings are escaped as `JSON.stringify` escapes them and numbers written as ECMAScript writes
/// them (`1e+21`, `-0` as `0`), or with their exact digits above 2^53. The same value gives the
/// same text whatever order its members were inserted in. The IR and its source map are written
/// with it.
#[must_use]
pub fn canonical_document(value: &JsonValue) -> String {
    let mut text = String::new();

    let format = Format {
        layout: Layout::Indented,
        order: MemberOrder::Utf16,
        numbers: NumberText::Written,
    };

    write_value(&mut text, value, format, "");
    text.push('\n');

    text
}

/// The text `JSON.stringify(value, null, 2)` writes, then a final newline: members in the
/// object's own order, two-space indentation, LF line endings.
///
/// Strings are escaped as `JSON.stringify` escapes them and numbers written as ECMAScript writes
/// them, or with their exact digits above 2^53. The oracle's `diagnostics.json` and pass-half
/// files are written with it.
#[must_use]
pub fn indented_json(value: &JsonValue) -> String {
    let mut text = String::new();

    let format = Format {
        layout: Layout::Indented,
        order: MemberOrder::OwnKeys,
        numbers: NumberText::Written,
    };

    write_value(&mut text, value, format, "");
    text.push('\n');

    text
}

/// The compact canonical text of a value, so two equal values written in another key order are
/// one: `JSON.stringify` of the value with every object's keys sorted.
///
/// Keys sort by UTF-16 code units, then the rebuilt object lists array-index keys (`"10"`, `"9"`)
/// first in ascending value, as JavaScript does. Numbers are written as the `f64` JavaScript
/// holds, so an integer above 2^53 is rounded, as `canonicalJson` did: values that are equal
/// (`==`) have one key. Use it as a comparison or lookup key, never as
/// file bytes: [`canonical_document`] writes those.
#[must_use]
pub fn canonical_json(value: &JsonValue) -> String {
    let mut text = String::new();

    let format = Format {
        layout: Layout::Compact,
        order: MemberOrder::Utf16RebuiltAsObject,
        numbers: NumberText::AsJavaScriptHolds,
    };

    write_value(&mut text, value, format, "");

    text
}

/// Appends `text` as `JSON.stringify` writes a string: quoted, with `"`, `\` and the control
/// characters escaped, every other character as itself (U+2028 and U+2029 included).
pub fn write_json_string(output: &mut String, text: &str) {
    output.push('"');

    for character in text.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{8}' => output.push_str("\\b"),
            '\u{c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control < ' ' => write_unicode_escape(output, control),
            other => output.push(other),
        }
    }

    output.push('"');
}

#[expect(
    clippy::format_push_string,
    reason = "a rare path; `fmt::Write` on a `String` would leave an infallible `Result` to discard"
)]
fn write_unicode_escape(output: &mut String, character: char) {
    output.push_str(&format!("\\u{:04x}", u32::from(character)));
}

fn write_number(output: &mut String, number: &JsonNumber, numbers: NumberText) {
    match numbers {
        NumberText::Written => output.push_str(&number.to_string()),
        NumberText::AsJavaScriptHolds => output.push_str(&number.finite_value().to_string()),
    }
}

fn write_value(output: &mut String, value: &JsonValue, format: Format, indent: &str) {
    match value {
        JsonValue::Null => output.push_str("null"),
        JsonValue::Bool(flag) => output.push_str(if *flag { "true" } else { "false" }),
        JsonValue::Number(number) => write_number(output, number, format.numbers),
        JsonValue::String(text) => write_json_string(output, text),
        JsonValue::Array(items) => write_array(output, items, format, indent),
        JsonValue::Object(members) => write_object(output, members, format, indent),
    }
}

fn write_array(output: &mut String, items: &[JsonValue], format: Format, indent: &str) {
    if items.is_empty() {
        output.push_str("[]");

        return;
    }

    let inner_indent = format!("{indent}{INDENT}");

    output.push('[');

    for (position, item) in items.iter().enumerate() {
        write_separator(output, format.layout, position, &inner_indent);
        write_value(output, item, format, &inner_indent);
    }

    write_closing_line(output, format.layout, indent);
    output.push(']');
}

fn write_object(output: &mut String, members: &JsonObject, format: Format, indent: &str) {
    if members.is_empty() {
        output.push_str("{}");

        return;
    }

    let inner_indent = format!("{indent}{INDENT}");
    let name_separator = match format.layout {
        Layout::Compact => ":",
        Layout::Indented => ": ",
    };

    output.push('{');

    for (position, (name, member)) in ordered_members(members, format.order)
        .into_iter()
        .enumerate()
    {
        write_separator(output, format.layout, position, &inner_indent);
        write_json_string(output, name);
        output.push_str(name_separator);
        write_value(output, member, format, &inner_indent);
    }

    write_closing_line(output, format.layout, indent);
    output.push('}');
}

fn ordered_members(members: &JsonObject, order: MemberOrder) -> Vec<(&String, &JsonValue)> {
    match order {
        MemberOrder::OwnKeys => members.iter().collect(),
        MemberOrder::Utf16 => members_by_utf16_name(members),
        MemberOrder::Utf16RebuiltAsObject => js_key_order(members_by_utf16_name(members)).collect(),
    }
}

fn members_by_utf16_name(members: &JsonObject) -> Vec<(&String, &JsonValue)> {
    let mut sorted_members: Vec<(&String, &JsonValue)> = members.iter().collect();

    sorted_members.sort_by(|(left_name, _), (right_name, _)| cmp_utf16(left_name, right_name));

    sorted_members
}

/// Writes what goes before the item or member at `position`: a comma after the first, and in an
/// indented layout a new line and the indentation.
fn write_separator(output: &mut String, layout: Layout, position: usize, inner_indent: &str) {
    if position > 0 {
        output.push(',');
    }

    if layout == Layout::Indented {
        output.push('\n');
        output.push_str(inner_indent);
    }
}

fn write_closing_line(output: &mut String, layout: Layout, indent: &str) {
    if layout == Layout::Indented {
        output.push('\n');
        output.push_str(indent);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(text: &str) -> JsonValue {
        serde_json::from_str(text).unwrap()
    }

    fn quoted(text: &str) -> String {
        let mut output = String::new();

        write_json_string(&mut output, text);

        output
    }

    #[test]
    fn two_objects_in_another_key_order_have_one_canonical_text_at_any_depth() {
        assert_eq!(
            canonical_json(&value(r#"{"b": 1, "a": {"d": 2, "c": 3}}"#)),
            canonical_json(&value(r#"{"a": {"c": 3, "d": 2}, "b": 1}"#))
        );
        assert_eq!(
            canonical_json(&value(r#"{"b": 1, "a": 2}"#)),
            r#"{"a":2,"b":1}"#
        );
    }

    #[test]
    fn array_order_is_kept_and_objects_inside_an_array_are_sorted() {
        assert_eq!(
            canonical_json(&value(r#"[{"b": 1, "a": 2}, 3]"#)),
            r#"[{"a":2,"b":1},3]"#
        );
        assert_ne!(
            canonical_json(&value("[1, 2]")),
            canonical_json(&value("[2, 1]"))
        );
    }

    #[test]
    fn scalars_and_null_are_their_json_text() {
        assert_eq!(canonical_json(&JsonValue::Null), "null");
        assert_eq!(canonical_json(&JsonValue::String("x".to_owned())), r#""x""#);
        assert_eq!(canonical_json(&value("true")), "true");
    }

    #[test]
    fn the_compact_text_lists_array_index_keys_first_as_javascript_rebuilds_the_object() {
        assert_eq!(
            canonical_json(&value(r#"{"b": 1, "200": 2, "9": 3}"#)),
            r#"{"9":3,"200":2,"b":1}"#
        );
    }

    #[test]
    fn the_document_writes_members_in_utf16_order_with_two_space_indent_and_a_final_newline() {
        let document = canonical_document(&value(
            r#"{"b": [1, {}], "200": [], "9": {"y": null, "x": "s"}}"#,
        ));

        assert_eq!(
            document,
            "{\n  \"200\": [],\n  \"9\": {\n    \"x\": \"s\",\n    \"y\": null\n  },\n  \"b\": [\n    1,\n    {}\n  ]\n}\n"
        );
    }

    #[test]
    fn astral_names_sort_before_private_use_names_as_utf16_units_do() {
        let document = canonical_document(&value("{\"\u{E000}\": 1, \"\u{1F600}\": 2}"));

        assert_eq!(document, "{\n  \"\u{1F600}\": 2,\n  \"\u{E000}\": 1\n}\n");
    }

    #[test]
    fn numbers_are_written_as_ecmascript_writes_them_or_with_their_exact_digits() {
        let document =
            canonical_document(&value("[-0, 1e21, 1e-7, 1e-17, 4.04e2, 9007199254740993]"));

        assert_eq!(
            document,
            "[\n  0,\n  1e+21,\n  1e-7,\n  1e-17,\n  404,\n  9007199254740993\n]\n"
        );
    }

    #[test]
    fn values_equal_as_javascript_have_one_comparison_key() {
        let exact = value("[9007199254740993]");
        let rounded = value("[9007199254740992]");

        assert_eq!(exact, rounded);
        assert_eq!(canonical_json(&exact), canonical_json(&rounded));
        assert_eq!(canonical_json(&exact), "[9007199254740992]");
        assert_ne!(canonical_document(&exact), canonical_document(&rounded));
    }

    #[test]
    fn strings_are_escaped_as_json_stringify_escapes_them() {
        assert_eq!(quoted("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(quoted("\u{8}\u{c}\n\r\t"), r#""\b\f\n\r\t""#);
        assert_eq!(quoted("\u{0}\u{1f}"), r#""\u0000\u001f""#);
        assert_eq!(
            quoted("\u{7f}\u{2028}\u{2029}/"),
            "\"\u{7f}\u{2028}\u{2029}/\""
        );
        assert_eq!(quoted("\u{1F600}"), "\"\u{1F600}\"");
    }

    #[test]
    fn the_indented_text_keeps_the_own_key_order_with_array_index_keys_first() {
        let text = indented_json(&value(r#"{"b": [1, {}], "a": null, "9": -0}"#));

        assert_eq!(
            text,
            "{\n  \"9\": 0,\n  \"b\": [\n    1,\n    {}\n  ],\n  \"a\": null\n}\n"
        );
    }

    #[test]
    fn empty_containers_stay_on_one_line() {
        assert_eq!(canonical_document(&value("{}")), "{}\n");
        assert_eq!(canonical_document(&value("[]")), "[]\n");
        assert_eq!(canonical_document(&value(r#""top""#)), "\"top\"\n");
    }
}
