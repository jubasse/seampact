//! The failure of a malformed name, never guessed around.

use thiserror::Error;

/// A name, a role, a language or an option the naming module refuses.
///
/// The TypeScript module throws these; the messages are kept, so a caller can still match on the
/// words `segment`, `status`, `position`, `escape` and `suffix`.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum NamingError {
    /// A role this version does not know (open enums: an unknown value is never guessed).
    #[error("unknown naming role {0:?}")]
    UnknownRole(String),
    /// A language this version does not know.
    #[error("unknown naming language {0:?}")]
    UnknownLanguage(String),
    /// A segment outside `[a-z0-9]+`.
    #[error("a naming segment is [a-z0-9]+, got {0:?}")]
    MalformedSegment(String),
    /// A response status that is missing or outside 200 to 399.
    #[error("a response status is an integer from {min} to {max}, got {got}", min = crate::roles::MIN_STATUS, max = crate::roles::MAX_STATUS)]
    BadResponseStatus {
        /// The status as written, `undefined` when missing.
        got: String,
    },
    /// A status on a role that is not `response`.
    #[error("role {role} has no status, got {status}")]
    UnexpectedStatus {
        /// The role that carries the status.
        role: String,
        /// The status it carries.
        status: i64,
    },
    /// A suffix word outside `[a-z0-9]+`.
    #[error("the suffix of role {role} is [a-z0-9]+, got {word:?}")]
    MalformedSuffix {
        /// The role the suffix is set for.
        role: String,
        /// The offending word.
        word: String,
    },
    /// An escape text outside `[A-Za-z0-9_]+`.
    #[error("escape text is [A-Za-z0-9_]+, got {0:?}")]
    MalformedEscapeText(String),
    /// A prefix escape that starts with a digit.
    #[error("a prefix escape cannot start with a digit")]
    EscapePrefixStartsWithDigit,
    /// A name that has no segment and no suffix word.
    #[error("a {role} name without segment has no identifier")]
    NoSegment {
        /// The role of the name.
        role: String,
    },
    /// An operation id built from no segment.
    #[error("an operation id needs at least one segment")]
    EmptyOperationId,
    /// An enum value asked without its one-based position.
    #[error("an enum value needs its one-based position, got {0}")]
    MissingPosition(String),
    /// The bundled reserved-words file is malformed.
    #[error("reserved-words.json: {0}")]
    ReservedWords(String),
}
