//! The errors of reading JSON into the crate's types.

use std::ops::RangeInclusive;

/// A JSON value the crate's types cannot hold.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum JsonError {
    /// A number with no finite `f64`, such as `1e400`.
    #[error("the number {text} at '{pointer}' is outside the range of a JSON number in JavaScript")]
    NumberOutOfRange {
        /// The number as written.
        text: String,
        /// The JSON pointer of the number.
        pointer: String,
    },

    /// A value that is not an integer within the range an integer member allows.
    #[error("expected an integer from {} to {}, found {found}", .allowed.start(), .allowed.end())]
    NotAnIntegerInRange {
        /// The text of the value found.
        found: String,
        /// The range the member allows.
        allowed: RangeInclusive<i64>,
    },
}

/// The most characters of untrusted text an error message quotes.
const QUOTED_TEXT_LIMIT: usize = 64;

/// `text` cut to [`QUOTED_TEXT_LIMIT`] characters, with an ellipsis when it was cut.
pub(crate) fn quoted_in_error(text: &str) -> String {
    let mut characters = text.chars();
    let mut quoted: String = characters.by_ref().take(QUOTED_TEXT_LIMIT).collect();

    if characters.next().is_some() {
        quoted.push('\u{2026}');
    }

    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_text_is_cut_with_an_ellipsis_and_short_text_is_kept() {
        assert_eq!(quoted_in_error("short"), "short");
        assert_eq!(
            quoted_in_error(&"a".repeat(QUOTED_TEXT_LIMIT))
                .chars()
                .count(),
            QUOTED_TEXT_LIMIT
        );

        let cut = quoted_in_error(&"a".repeat(QUOTED_TEXT_LIMIT + 1));

        assert_eq!(cut.chars().count(), QUOTED_TEXT_LIMIT + 1);
        assert!(cut.ends_with('\u{2026}'));
    }
}
