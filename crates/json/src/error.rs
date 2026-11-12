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
