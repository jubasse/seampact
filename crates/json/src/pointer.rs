//! JSON Pointer segments (RFC 6901).

/// A key or an index as a pointer segment: `~` as `~0`, `/` as `~1`.
///
/// An index is passed as its decimal text (`index.to_string()`), which is the text JavaScript's
/// `String(index)` gives.
#[must_use]
pub fn escape_pointer(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
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
