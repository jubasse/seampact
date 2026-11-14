//! How a message names the value at a JSON Pointer.

use seampact_diagnostics::quote_text;

fn is_decimal_digits(segment: &str) -> bool {
    !segment.is_empty() && segment.chars().all(|character| character.is_ascii_digit())
}

/// The last segment of a pointer, unescaped; empty when the pointer has no `/`.
#[must_use]
pub(crate) fn last_segment(pointer: &str) -> String {
    let Some((_, segment)) = pointer.rsplit_once('/') else {
        return String::new();
    };

    segment.replace("~1", "/").replace("~0", "~")
}

/// How a message names the mapping at `pointer`: its key, or its list and index.
#[must_use]
pub(crate) fn where_(pointer: &str) -> String {
    if pointer.is_empty() {
        return "the file's root".to_owned();
    }

    let segment = last_segment(pointer);

    if is_decimal_digits(&segment) {
        let parent = pointer.rsplit_once('/').map_or("", |(parent, _)| parent);

        return format!("{}[{segment}]", quote_text(&last_segment(parent)));
    }

    quote_text(&segment)
}

/// The subject of a sentence about the value at `pointer`.
#[must_use]
pub(crate) fn subject_of(pointer: &str) -> String {
    if pointer.is_empty() {
        return "The file".to_owned();
    }

    quote_text(&last_segment(pointer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_segment_is_unescaped() {
        assert_eq!(last_segment("/a/b~1c~0d"), "b/c~d");
        assert_eq!(last_segment("/a~01"), "a~1");
        assert_eq!(last_segment("no-slash"), "");
        assert_eq!(last_segment(""), "");
    }

    #[test]
    fn a_mapping_in_a_list_is_named_by_its_list_and_index() {
        assert_eq!(where_(""), "the file's root");
        assert_eq!(where_("/surfaces/main"), "'main'");
        assert_eq!(where_("/surfaces/rules/12"), "'rules'[12]");
        assert_eq!(where_("/a/"), "''");
        assert_eq!(subject_of(""), "The file");
        assert_eq!(subject_of("/a/b"), "'b'");
    }
}
