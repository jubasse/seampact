//! The differences between an expected file and the compiled one: every JSON pointer where the
//! two values differ, and the lines around one of them.

use seampact_json::escape_pointer;
use serde_json::Value;

/// How many lines of context are shown each side of a mismatch.
const CONTEXT_LINES: usize = 3;

/// The width of the line number before a context line.
const LINE_NUMBER_WIDTH: usize = 6;

/// The most characters of a context line shown; a longer line is cut around the differing column.
const CONTEXT_LINE_WIDTH: usize = 100;

/// Marks the side of a context line that was cut.
const CUT_MARK: &str = "...";

/// What differs at one pointer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MismatchKind {
    /// A scalar, or a value of another type, differs.
    Value,
    /// A member or an array item is only in the compiled output (the whole file at the root).
    Added,
    /// A member or an array item is only in the expected output (the whole file at the root).
    Removed,
    /// An object has the same members in another order; no entry can accept it.
    MemberOrder,
    /// The texts differ where the values do not: layout, string escapes or number notation, outside
    /// any accepted difference; no entry can accept it.
    Text,
    /// The compiled file is no JSON; no entry can accept it.
    Unparsable,
}

/// One difference between an expected file and the compiled one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mismatch {
    /// The JSON Pointer of the difference, `""` for the root; absent for a text-only difference.
    pub pointer: Option<String>,
    /// What differs.
    pub kind: MismatchKind,
    /// The expected (TS) value at the pointer, when it has one.
    pub expected: Option<Value>,
    /// The compiled (Rust) value at the pointer, when it has one.
    pub actual: Option<Value>,
}

impl Mismatch {
    /// One line saying what differs.
    #[must_use]
    pub fn summary(&self) -> String {
        let at = match self.pointer.as_deref() {
            None => String::new(),
            Some("") => "the root".to_owned(),
            Some(pointer) => pointer.to_owned(),
        };

        match self.kind {
            MismatchKind::Value => format!("the value at {at} differs"),
            MismatchKind::Added => format!("{at} is only in the compiled output"),
            MismatchKind::Removed => format!("{at} is only in the expected output"),
            MismatchKind::MemberOrder => format!("the members of {at} are in another order"),
            MismatchKind::Text => {
                "the text differs beyond the values (layout, string escapes or number notation)"
                    .to_owned()
            }
            MismatchKind::Unparsable => "the compiled file is no JSON".to_owned(),
        }
    }
}

/// Every difference between two parsed values, in document order; empty when they are equal.
///
/// Arrays compare by position, a length difference giving one `Added` or `Removed` per extra
/// index; objects by member name; numbers by the value of their token, so integers above 2^53
/// compare exactly and `-0` differs from `0`, while the exponent spelling (`1E21`, `1e+21`) is
/// not a difference here. [`text_mismatches`] and the run hold the text to byte identity.
#[must_use]
pub fn value_mismatches(expected: &Value, actual: &Value) -> Vec<Mismatch> {
    let mut mismatches = Vec::new();

    collect_mismatches(expected, actual, "", &mut mismatches);

    mismatches
}

/// Every difference between an expected text and a compiled one, in document order; a text that
/// differs with equal values is one `Text` mismatch.
///
/// # Errors
///
/// When the expected text is no JSON.
pub fn text_mismatches(
    expected_text: &str,
    actual_text: &str,
) -> Result<Vec<Mismatch>, serde_json::Error> {
    if expected_text == actual_text {
        return Ok(Vec::new());
    }

    let expected: Value = serde_json::from_str(expected_text)?;

    let Ok(actual) = serde_json::from_str::<Value>(actual_text) else {
        return Ok(vec![Mismatch {
            pointer: None,
            kind: MismatchKind::Unparsable,
            expected: Some(expected),
            actual: None,
        }]);
    };

    let mismatches = value_mismatches(&expected, &actual);

    if mismatches.is_empty() {
        return Ok(vec![Mismatch {
            pointer: None,
            kind: MismatchKind::Text,
            expected: Some(expected),
            actual: Some(actual),
        }]);
    }

    Ok(mismatches)
}

/// The mismatch of a file whose values are all accepted but whose text differs elsewhere.
pub(crate) fn text_beyond_accepted() -> Mismatch {
    Mismatch {
        pointer: None,
        kind: MismatchKind::Text,
        expected: None,
        actual: None,
    }
}

fn collect_mismatches(expected: &Value, actual: &Value, pointer: &str, found: &mut Vec<Mismatch>) {
    match (expected, actual) {
        (Value::Array(expected_items), Value::Array(actual_items)) => {
            collect_array_mismatches(expected_items, actual_items, pointer, found);
        }
        (Value::Object(expected_members), Value::Object(actual_members)) => {
            collect_object_mismatches(expected_members, actual_members, pointer, found);
        }
        _ if expected == actual => {}
        _ => found.push(Mismatch {
            pointer: Some(pointer.to_owned()),
            kind: MismatchKind::Value,
            expected: Some(expected.clone()),
            actual: Some(actual.clone()),
        }),
    }
}

fn collect_array_mismatches(
    expected_items: &[Value],
    actual_items: &[Value],
    pointer: &str,
    found: &mut Vec<Mismatch>,
) {
    for (index, (expected_item, actual_item)) in expected_items.iter().zip(actual_items).enumerate()
    {
        collect_mismatches(
            expected_item,
            actual_item,
            &format!("{pointer}/{index}"),
            found,
        );
    }

    let common_length = expected_items.len().min(actual_items.len());

    for (offset, removed_item) in expected_items.iter().skip(common_length).enumerate() {
        found.push(only_in_one(
            format!("{pointer}/{}", common_length + offset),
            MismatchKind::Removed,
            removed_item,
        ));
    }

    for (offset, added_item) in actual_items.iter().skip(common_length).enumerate() {
        found.push(only_in_one(
            format!("{pointer}/{}", common_length + offset),
            MismatchKind::Added,
            added_item,
        ));
    }
}

fn collect_object_mismatches(
    expected_members: &serde_json::Map<String, Value>,
    actual_members: &serde_json::Map<String, Value>,
    pointer: &str,
    found: &mut Vec<Mismatch>,
) {
    let common_in_expected_order: Vec<&String> = expected_members
        .keys()
        .filter(|name| actual_members.contains_key(*name))
        .collect();
    let common_in_actual_order: Vec<&String> = actual_members
        .keys()
        .filter(|name| expected_members.contains_key(*name))
        .collect();

    if common_in_expected_order != common_in_actual_order {
        found.push(Mismatch {
            pointer: Some(pointer.to_owned()),
            kind: MismatchKind::MemberOrder,
            expected: None,
            actual: None,
        });
    }

    for (name, expected_member) in expected_members {
        let member_pointer = format!("{pointer}/{}", escape_pointer(name));

        match actual_members.get(name) {
            Some(actual_member) => {
                collect_mismatches(expected_member, actual_member, &member_pointer, found);
            }
            None => found.push(only_in_one(
                member_pointer,
                MismatchKind::Removed,
                expected_member,
            )),
        }
    }

    for (name, actual_member) in actual_members {
        if !expected_members.contains_key(name) {
            let member_pointer = format!("{pointer}/{}", escape_pointer(name));

            found.push(only_in_one(
                member_pointer,
                MismatchKind::Added,
                actual_member,
            ));
        }
    }
}

/// A value only in one output: the whole of a file present on one side is one at the root.
#[must_use]
pub fn only_in_one(pointer: String, kind: MismatchKind, value: &Value) -> Mismatch {
    let (expected, actual) = match kind {
        MismatchKind::Removed => (Some(value.clone()), None),
        _ => (None, Some(value.clone())),
    };

    Mismatch {
        pointer: Some(pointer),
        kind,
        expected,
        actual,
    }
}

/// The unescaped segments of a JSON Pointer.
pub(crate) fn pointer_segments(pointer: &str) -> Vec<String> {
    pointer
        .split('/')
        .skip(1)
        .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
        .collect()
}

/// The expected and the compiled lines around a mismatch, numbered: around the line of its
/// pointer on each side, or around the first differing line when it has none. A side with no
/// text has no lines; a long line is cut around the column where the two sides differ.
#[must_use]
pub fn mismatch_context(
    expected_text: Option<&str>,
    actual_text: Option<&str>,
    mismatch: &Mismatch,
) -> (Vec<String>, Vec<String>) {
    let expected_lines = lines_of(expected_text);
    let actual_lines = lines_of(actual_text);

    let first_differing_line = expected_lines
        .iter()
        .zip(&actual_lines)
        .take_while(|(expected_line, actual_line)| expected_line == actual_line)
        .count();

    let line_of = |text: Option<&str>| match (&mismatch.pointer, parsed(text)) {
        (Some(pointer), Some(value)) => line_of_pointer(&value, &pointer_segments(pointer)),
        _ => first_differing_line,
    };

    let expected_index = line_of(expected_text).min(expected_lines.len().saturating_sub(1));
    let actual_index = line_of(actual_text).min(actual_lines.len().saturating_sub(1));
    let column = differing_column(
        expected_lines.get(expected_index),
        actual_lines.get(actual_index),
    );

    (
        context_around(&expected_lines, expected_index, column),
        context_around(&actual_lines, actual_index, column),
    )
}

fn lines_of(text: Option<&str>) -> Vec<&str> {
    text.map_or_else(Vec::new, |text| {
        text.trim_end_matches('\n').split('\n').collect()
    })
}

fn parsed(text: Option<&str>) -> Option<Value> {
    serde_json::from_str(text?).ok()
}

/// The first character position where two lines differ; 0 when a side has no such line.
fn differing_column(expected_line: Option<&&str>, actual_line: Option<&&str>) -> usize {
    let (Some(expected_line), Some(actual_line)) = (expected_line, actual_line) else {
        return 0;
    };

    expected_line
        .chars()
        .zip(actual_line.chars())
        .take_while(|(expected_character, actual_character)| expected_character == actual_character)
        .count()
}

fn context_around(lines: &[&str], index: usize, column: usize) -> Vec<String> {
    let first = index.saturating_sub(CONTEXT_LINES);

    lines
        .iter()
        .enumerate()
        .skip(first)
        .take(index + CONTEXT_LINES + 1 - first)
        .map(|(position, line)| {
            format!(
                "{:>LINE_NUMBER_WIDTH$} {}",
                position + 1,
                line_around_column(line, column)
            )
        })
        .collect()
}

/// `line`, or its `CONTEXT_LINE_WIDTH` characters around `column` when it is longer.
fn line_around_column(line: &str, column: usize) -> String {
    let length = line.chars().count();

    if length <= CONTEXT_LINE_WIDTH {
        return line.to_owned();
    }

    let start = column
        .saturating_sub(CONTEXT_LINE_WIDTH / 2)
        .min(length - CONTEXT_LINE_WIDTH);
    let end = start + CONTEXT_LINE_WIDTH;
    let shown: String = line.chars().skip(start).take(CONTEXT_LINE_WIDTH).collect();
    let before = if start > 0 { CUT_MARK } else { "" };
    let after = if end < length { CUT_MARK } else { "" };

    format!("{before}{shown}{after}")
}

/// The line, in the two-space indented layout, of the deepest value along `segments` that exists.
fn line_of_pointer(value: &Value, segments: &[String]) -> usize {
    let Some((segment, other_segments)) = segments.split_first() else {
        return 0;
    };

    let children: Vec<(&Value, bool)> = match value {
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| (item, index.to_string() == *segment))
            .collect(),
        Value::Object(members) => members
            .iter()
            .map(|(name, member)| (member, name == segment))
            .collect(),
        _ => return 0,
    };

    let Some(position) = children.iter().position(|(_, is_target)| *is_target) else {
        return 0;
    };

    let lines_before: usize = children
        .iter()
        .take(position)
        .map(|(child, _)| line_count(child))
        .sum();
    let child_lines = children
        .get(position)
        .map_or(0, |(child, _)| line_of_pointer(child, other_segments));

    1 + lines_before + child_lines
}

/// The lines a value takes in the two-space indented layout.
fn line_count(value: &Value) -> usize {
    let children_lines: usize = match value {
        Value::Array(items) if !items.is_empty() => items.iter().map(line_count).sum(),
        Value::Object(members) if !members.is_empty() => members.values().map(line_count).sum(),
        _ => return 1,
    };

    children_lines + 2
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    fn pointers_and_kinds(expected: &str, actual: &str) -> Vec<(String, MismatchKind)> {
        value_mismatches(&value(expected), &value(actual))
            .into_iter()
            .map(|mismatch| (mismatch.pointer.unwrap_or_default(), mismatch.kind))
            .collect()
    }

    #[test]
    fn numbers_compare_by_their_token() {
        assert_eq!(
            pointers_and_kinds("[0, 9007199254740992]", "[-0, 9007199254740993]"),
            vec![
                ("/0".to_owned(), MismatchKind::Value),
                ("/1".to_owned(), MismatchKind::Value)
            ]
        );
        assert_eq!(pointers_and_kinds("[1e21]", "[1e21]"), vec![]);
    }

    #[test]
    fn an_array_length_difference_gives_one_mismatch_per_extra_index() {
        assert_eq!(
            pointers_and_kinds("[1, 2, 3]", "[1]"),
            vec![
                ("/1".to_owned(), MismatchKind::Removed),
                ("/2".to_owned(), MismatchKind::Removed)
            ]
        );
        assert_eq!(
            pointers_and_kinds("[]", "[{}]"),
            vec![("/0".to_owned(), MismatchKind::Added)]
        );
    }

    #[test]
    fn members_compare_by_name_with_escaped_and_astral_names() {
        assert_eq!(
            pointers_and_kinds(
                "{\"a/b\": 1, \"\u{1F600}\": 2, \"gone\": 3}",
                "{\"a/b\": 2, \"\u{1F600}\": 2, \"new~\": 4}"
            ),
            vec![
                ("/a~1b".to_owned(), MismatchKind::Value),
                ("/gone".to_owned(), MismatchKind::Removed),
                ("/new~0".to_owned(), MismatchKind::Added)
            ]
        );
        assert_eq!(
            pointers_and_kinds("{\"\u{1F600}\": [1]}", "{\"\u{1F600}\": [2]}"),
            vec![("/\u{1F600}/0".to_owned(), MismatchKind::Value)]
        );
    }

    #[test]
    fn the_same_members_in_another_order_are_a_member_order_mismatch() {
        assert_eq!(
            pointers_and_kinds(r#"{"a": {"x": 1, "y": 2}}"#, r#"{"a": {"y": 2, "x": 1}}"#),
            vec![("/a".to_owned(), MismatchKind::MemberOrder)]
        );
    }

    #[test]
    fn equal_values_written_otherwise_are_a_text_mismatch() {
        let mismatches = text_mismatches("[1]\n", "[ 1 ]\n").unwrap();

        assert_eq!(mismatches.len(), 1);
        assert_eq!(
            mismatches.first().map(|mismatch| mismatch.kind),
            Some(MismatchKind::Text)
        );
    }

    #[test]
    fn the_context_is_around_the_line_of_the_pointer() {
        let expected = "{\n  \"a\": [\n    1,\n    2\n  ],\n  \"b\": 3\n}\n";
        let actual = "{\n  \"a\": [\n    1,\n    2\n  ],\n  \"b\": 4\n}\n";
        let mismatch = text_mismatches(expected, actual).unwrap().remove(0);

        let (expected_context, actual_context) =
            mismatch_context(Some(expected), Some(actual), &mismatch);

        assert_eq!(mismatch.pointer.as_deref(), Some("/b"));
        assert_eq!(
            expected_context,
            vec![
                "     3     1,",
                "     4     2",
                "     5   ],",
                "     6   \"b\": 3",
                "     7 }"
            ]
        );
        assert_eq!(
            actual_context.get(3).map(String::as_str),
            Some("     6   \"b\": 4")
        );
    }

    #[test]
    fn a_one_line_file_is_cut_around_the_differing_column() {
        let padding = "x".repeat(500);
        let expected = format!("{{\"a\": \"{padding}\", \"b\": 1, \"c\": \"{padding}\"}}\n");
        let actual = format!("{{\"a\": \"{padding}\", \"b\": 2, \"c\": \"{padding}\"}}\n");
        let mismatch = text_mismatches(&expected, &actual).unwrap().remove(0);

        let (expected_context, actual_context) =
            mismatch_context(Some(&expected), Some(&actual), &mismatch);

        let expected_line = expected_context.first().unwrap();
        let actual_line = actual_context.first().unwrap();

        assert!(expected_line.chars().count() < 200, "{expected_line}");
        assert!(expected_line.contains("\"b\": 1"), "{expected_line}");
        assert!(actual_line.contains("\"b\": 2"), "{actual_line}");
        assert!(expected_line.contains(CUT_MARK));
    }

    #[test]
    fn a_side_with_no_text_has_no_context() {
        let mismatch = only_in_one(String::new(), MismatchKind::Removed, &value("[1]"));

        let (expected_context, actual_context) = mismatch_context(Some("[1]\n"), None, &mismatch);

        assert_eq!(expected_context, vec!["     1 [1]"]);
        assert_eq!(actual_context, Vec::<String>::new());
    }
}
