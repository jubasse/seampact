//! A value a change reports.

use seampact_json::JsonNumber;

/// A scalar a change reports, never an IR object.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffValue {
    /// A string.
    Text(String),
    /// A number.
    Number(JsonNumber),
    /// A boolean.
    Bool(bool),
    /// `null`.
    Null,
}
