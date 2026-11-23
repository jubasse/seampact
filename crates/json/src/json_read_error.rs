//! The error of reading a [`JsonValue`](crate::JsonValue) into a type.

use std::fmt;

use serde::de;

use crate::escape_pointer;

/// Why a value did not read into its type: what failed, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonReadError {
    /// The JSON pointer of the failing value; empty for the root, and for a member the type
    /// requires but the value lacks (the pointer is then its parent's).
    pub pointer: String,
    /// What serde reported.
    pub reason: String,
    /// Whether a member was unknown or the value was wrong.
    pub kind: JsonReadKind,
}

/// The two ways a value fails to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JsonReadKind {
    /// An object member the type refuses by name (`deny_unknown_fields`); the pointer names it.
    UnknownMember,
    /// Any other failure: a wrong kind of value, a missing member, a rejected value.
    Invalid,
}

impl JsonReadError {
    /// The error seen from the parent: the pointer starts with the parent's member `segment`.
    pub(crate) fn below(mut self, segment: &str) -> Self {
        self.pointer = format!("/{}{}", escape_pointer(segment), self.pointer);

        self
    }
}

impl fmt::Display for JsonReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.pointer.is_empty() {
            return write!(formatter, "{}", self.reason);
        }

        write!(formatter, "{} at '{}'", self.reason, self.pointer)
    }
}

impl std::error::Error for JsonReadError {}

impl de::Error for JsonReadError {
    fn custom<Message: fmt::Display>(message: Message) -> Self {
        Self {
            pointer: String::new(),
            reason: message.to_string(),
            kind: JsonReadKind::Invalid,
        }
    }

    fn unknown_field(field: &str, expected: &'static [&'static str]) -> Self {
        let reason = if expected.is_empty() {
            format!("unknown field `{field}`, there are no fields")
        } else {
            format!("unknown field `{field}`, expected one of {expected:?}")
        };

        Self {
            pointer: String::new(),
            reason,
            kind: JsonReadKind::UnknownMember,
        }
        .below(field)
    }
}
