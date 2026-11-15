//! JSON Pointers (RFC 6901): segment escapes and the value a pointer names.

use crate::{JsonObject, JsonValue};

/// A key or an index as a pointer segment: `~` as `~0`, `/` as `~1`.
///
/// An index is passed as its decimal text (`index.to_string()`), which is the text JavaScript's
/// `String(index)` gives.
#[must_use]
pub fn escape_pointer(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// The segments of a pointer, unescaped; `None` for a pointer that is neither empty nor starts
/// with `/`.
#[must_use]
pub fn pointer_segments(pointer: &str) -> Option<Vec<String>> {
    if pointer.is_empty() {
        return Some(Vec::new());
    }

    let rest = pointer.strip_prefix('/')?;

    Some(
        rest.split('/')
            .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
            .collect(),
    )
}

// A canonical array index: `0`, or digits with no leading zero.
fn array_index_of(segment: &str) -> Option<usize> {
    let canonical = segment == "0"
        || (segment.starts_with(|first: char| ('1'..='9').contains(&first))
            && segment.chars().all(|digit| digit.is_ascii_digit()));

    if !canonical {
        return None;
    }

    segment.parse().ok()
}

/// The value at `segments` below `value`, own members only; `None` when absent.
#[must_use]
pub fn json_at<'tree, S: AsRef<str>>(
    value: &'tree JsonValue,
    segments: &[S],
) -> Option<&'tree JsonValue> {
    let mut at = value;

    for segment in segments {
        at = match at {
            JsonValue::Array(items) => items.get(array_index_of(segment.as_ref())?)?,
            JsonValue::Object(object) => object.get(segment.as_ref())?,
            _ => return None,
        };
    }

    Some(at)
}

/// The value at `segments` below `object`; `None` when absent or when `segments` is empty
/// (an object is not a [`JsonValue`]).
#[must_use]
pub fn json_at_object<'tree, S: AsRef<str>>(
    object: &'tree JsonObject,
    segments: &[S],
) -> Option<&'tree JsonValue> {
    let (first, rest) = segments.split_first()?;

    json_at(object.get(first.as_ref())?, rest)
}

/// The value a pointer names in a tree, borrowed; `None` when it names nothing.
#[must_use]
pub fn json_at_pointer<'tree>(value: &'tree JsonValue, pointer: &str) -> Option<&'tree JsonValue> {
    json_at(value, &pointer_segments(pointer)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilde_and_slash_are_escaped_tilde_first() {
        assert_eq!(escape_pointer("a/b"), "a~1b");
        assert_eq!(escape_pointer("a~b"), "a~0b");
        assert_eq!(escape_pointer("~/"), "~0~1");
        assert_eq!(escape_pointer("~1"), "~01");
    }

    #[test]
    fn other_text_is_kept() {
        assert_eq!(escape_pointer(""), "");
        assert_eq!(escape_pointer("200"), "200");
        assert_eq!(escape_pointer("\u{1F600}\u{E000}"), "\u{1F600}\u{E000}");
    }
}
