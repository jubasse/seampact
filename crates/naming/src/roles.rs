//! Names as the IR stores them: word segments plus a role (ADR 0007 section 1).

use std::{collections::HashMap, str::FromStr};

use crate::error::NamingError;

/// The lowest status a `response` name can carry.
pub(crate) const MIN_STATUS: i64 = 200;

/// The highest status a `response` name can carry: success and redirect, what `responses` admits.
pub(crate) const MAX_STATUS: i64 = 399;

/// The role of a name (ADR 0007 section 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// A schema.
    Schema,
    /// An operation input.
    Input,
    /// An operation output.
    Output,
    /// A query object.
    Query,
    /// A headers object.
    Headers,
    /// A path params object.
    Path,
    /// A response body, with its status.
    Response,
    /// An error params object.
    Params,
    /// An error.
    Error,
    /// The errors of an operation.
    Errors,
    /// An inline property schema.
    Property,
    /// An array item schema.
    Item,
    /// A value schema.
    Value,
    /// A union variant.
    Variant,
    /// The endpoints of a tag.
    Endpoints,
    /// An operation.
    Operation,
    /// A member of a class or record.
    Member,
    /// An enum member.
    EnumMember,
}

/// Every role, in the order of ADR 0007 section 1.
pub const ROLES: [Role; 18] = [
    Role::Schema,
    Role::Input,
    Role::Output,
    Role::Query,
    Role::Headers,
    Role::Path,
    Role::Response,
    Role::Params,
    Role::Error,
    Role::Errors,
    Role::Property,
    Role::Item,
    Role::Value,
    Role::Variant,
    Role::Endpoints,
    Role::Operation,
    Role::Member,
    Role::EnumMember,
];

impl Role {
    /// The role as the IR spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Schema => "schema",
            Self::Input => "input",
            Self::Output => "output",
            Self::Query => "query",
            Self::Headers => "headers",
            Self::Path => "path",
            Self::Response => "response",
            Self::Params => "params",
            Self::Error => "error",
            Self::Errors => "errors",
            Self::Property => "property",
            Self::Item => "item",
            Self::Value => "value",
            Self::Variant => "variant",
            Self::Endpoints => "endpoints",
            Self::Operation => "operation",
            Self::Member => "member",
            Self::EnumMember => "enumMember",
        }
    }

    /// The role of the suffix word it takes, `None` for a role without one.
    #[must_use]
    pub const fn suffix_role(self) -> Option<SuffixRole> {
        match self {
            Self::Input => Some(SuffixRole::Input),
            Self::Output => Some(SuffixRole::Output),
            Self::Query => Some(SuffixRole::Query),
            Self::Headers => Some(SuffixRole::Headers),
            Self::Path => Some(SuffixRole::Path),
            Self::Response => Some(SuffixRole::Response),
            Self::Params => Some(SuffixRole::Params),
            Self::Error => Some(SuffixRole::Error),
            Self::Errors => Some(SuffixRole::Errors),
            Self::Item => Some(SuffixRole::Item),
            Self::Value => Some(SuffixRole::Value),
            Self::Endpoints => Some(SuffixRole::Endpoints),
            Self::Schema
            | Self::Property
            | Self::Variant
            | Self::Operation
            | Self::Member
            | Self::EnumMember => None,
        }
    }
}

impl FromStr for Role {
    type Err = NamingError;

    fn from_str(role: &str) -> Result<Self, NamingError> {
        assert_role(role)
    }
}

/// The roles that take a suffix word, set through the `suffixes` option (ADR 0007 section 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SuffixRole {
    /// The `input` role.
    Input,
    /// The `output` role.
    Output,
    /// The `query` role.
    Query,
    /// The `headers` role.
    Headers,
    /// The `path` role.
    Path,
    /// The `response` role.
    Response,
    /// The `params` role.
    Params,
    /// The `error` role.
    Error,
    /// The `errors` role.
    Errors,
    /// The `item` role.
    Item,
    /// The `value` role.
    Value,
    /// The `endpoints` role.
    Endpoints,
}

/// The suffix word each derived role takes instead of its default (`input` gives `dto`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Suffixes {
    words: HashMap<SuffixRole, String>,
}

impl Suffixes {
    /// No override: every role keeps its default word.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the word of `role`; the word is checked when a name uses it.
    #[must_use]
    pub fn with(mut self, role: SuffixRole, word: impl Into<String>) -> Self {
        self.words.insert(role, word.into());

        self
    }

    fn word_of(&self, role: SuffixRole) -> Option<&str> {
        self.words.get(&role).map(String::as_str)
    }
}

/// A name as the IR stores it.
///
/// A `response` name carries its integer `status`, which the segments alone cannot hold; no other
/// role has one. The fields are public so a name read from an IR can be built as read: every
/// function that uses one checks it with [`assert_name`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Name {
    /// The word segments, each `[a-z0-9]+`.
    pub segments: Vec<String>,
    /// The role.
    pub role: Role,
    /// The status of a `response`, absent for every other role.
    pub status: Option<i64>,
}

/// Whether `role` is one of the roles of ADR 0007 section 1.
#[must_use]
pub fn is_role(role: &str) -> bool {
    ROLES.iter().any(|known| known.as_str() == role)
}

/// The role spelled `role`.
///
/// # Errors
///
/// [`NamingError::UnknownRole`] for a role this version does not know: an unknown value is never
/// guessed.
pub fn assert_role(role: &str) -> Result<Role, NamingError> {
    ROLES
        .iter()
        .copied()
        .find(|known| known.as_str() == role)
        .ok_or_else(|| NamingError::UnknownRole(role.to_owned()))
}

/// Whether the identifier of `role` is a type, so that the shadowed type names apply to it.
#[must_use]
pub const fn is_type_role(role: Role) -> bool {
    match role {
        Role::Schema
        | Role::Input
        | Role::Output
        | Role::Query
        | Role::Headers
        | Role::Path
        | Role::Response
        | Role::Params
        | Role::Error
        | Role::Errors
        | Role::Property
        | Role::Item
        | Role::Value
        | Role::Variant
        | Role::Endpoints => true,
        Role::Operation | Role::Member | Role::EnumMember => false,
    }
}

// The default suffix word of each role (ADR 0007 section 1 table).
fn default_suffix(role: Role) -> Option<&'static str> {
    role.suffix_role().map(|_| role.as_str())
}

fn assert_status(status: Option<i64>) -> Result<i64, NamingError> {
    match status {
        Some(value) if (MIN_STATUS..=MAX_STATUS).contains(&value) => Ok(value),
        Some(value) => Err(NamingError::BadResponseStatus {
            got: value.to_string(),
        }),
        None => Err(NamingError::BadResponseStatus {
            got: "undefined".to_owned(),
        }),
    }
}

/// Whether `word` is a non-empty run of `[a-z0-9]`; ASCII only, as the TypeScript pattern is.
pub(crate) fn is_segment(word: &str) -> bool {
    !word.is_empty()
        && word
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

/// Checks that every segment is a `[a-z0-9]+` string: every identifier is built from them.
///
/// # Errors
///
/// [`NamingError::MalformedSegment`] naming the first segment that is not.
pub fn assert_segments(segments: &[String]) -> Result<(), NamingError> {
    match segments.iter().find(|segment| !is_segment(segment)) {
        Some(segment) => Err(NamingError::MalformedSegment(segment.clone())),
        None => Ok(()),
    }
}

/// Checks a name: valid segments, and a status exactly when the role is `response`.
///
/// Names built by hand or read from an IR are checked, never trusted.
///
/// # Errors
///
/// A [`NamingError`] naming the first defect.
pub fn assert_name(name: &Name) -> Result<(), NamingError> {
    assert_segments(&name.segments)?;

    if name.role == Role::Response {
        assert_status(name.status)?;

        return Ok(());
    }

    match name.status {
        Some(status) => Err(NamingError::UnexpectedStatus {
            role: name.role.as_str().to_owned(),
            status,
        }),
        None => Ok(()),
    }
}

/// The suffix words appended after the segments of `name`, in order.
///
/// `suffixes` replaces the word of a role (a `NestJS` habit: `input: "dto"`); the status of a
/// `response` still follows it.
///
/// # Errors
///
/// A [`NamingError`] for a malformed name or a suffix outside `[a-z0-9]+`.
pub fn suffix_words(name: &Name, suffixes: Option<&Suffixes>) -> Result<Vec<String>, NamingError> {
    assert_name(name)?;

    let Some(base) = default_suffix(name.role) else {
        return Ok(Vec::new());
    };
    let overridden = name
        .role
        .suffix_role()
        .and_then(|suffix_role| suffixes.and_then(|set| set.word_of(suffix_role)));
    let word = overridden.unwrap_or(base);

    if overridden.is_some() && !is_segment(word) {
        return Err(NamingError::MalformedSuffix {
            role: name.role.as_str().to_owned(),
            word: word.to_owned(),
        });
    }

    match (name.role, name.status) {
        (Role::Response, Some(status)) => Ok(vec![word.to_owned(), status.to_string()]),
        _ => Ok(vec![word.to_owned()]),
    }
}

/// The derived name of an inline schema or a generated type (ADR 0007 section 3).
///
/// `owner` holds the segments of the owner; for `property` and `variant` it already holds the
/// parent's whole name followed by the property's or the tag's segments. `status` is required
/// for a `response` and rejected for every other role.
///
/// # Errors
///
/// A [`NamingError`] for a malformed segment or status.
pub fn derive_name(owner: &[String], role: Role, status: Option<i64>) -> Result<Name, NamingError> {
    assert_segments(owner)?;

    let name = Name {
        segments: owner.to_vec(),
        role,
        status,
    };

    assert_name(&name)?;

    Ok(name)
}
