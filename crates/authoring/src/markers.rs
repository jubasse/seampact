//! The titles the authoring schemas write: markers the validate stage reports by, editor-only
//! titles and the data mark, with the names no map of the grammar admits as a key.

/// A title that marks a definition whose failures the validate stage reports by their own rule.
///
/// Variants are listed in the order of the TypeScript `MARKERS` table; [`MARKERS`] holds them all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Marker {
    /// A refused JSON Schema keyword (ADR 0003 section 1).
    Refused,
    /// A refused form of a kept keyword.
    RefusedForm,
    /// A key another key excludes; the description says which.
    Conflict,
    /// A reserved key or prefix (`x-seampact-`, `seampact`).
    Reserved,
    /// A reason.
    Reason,
    /// A mapping whose missing key is a missing reason.
    ReasonedPolicy,
    /// An access mapping whose missing key is a missing reason.
    Access,
    /// A CSRF exemption, which needs a reason.
    CsrfExemption,
    /// An idempotency exemption, which needs a reason.
    IdempotencyExemption,
    /// A query exception, which needs a reason.
    QueryException,
    /// An unknown-keys exception, which needs a reason.
    UnknownKeysException,
    /// A node that states no kind (ADR 0002 section 6).
    NodeMarker,
    /// A derive entry without an effect (ADR 0002 section 2).
    DeriveEntry,
    /// A mapping that needs one key of several; the description lists them.
    Choice,
    /// A value of neither accepted type (a string or a mapping); the description names both.
    Alternatives,
    /// A map of named tree nodes, the one mapping that refuses `$include` (ADR 0002 section 2).
    Routes,
    /// A name position (ADR 0002 section 4): a pattern failure is `invalid-name`.
    Name,
    /// A schema name position.
    SchemaName,
    /// A scalar name position.
    ScalarName,
    /// A right name position.
    RightName,
    /// An error code position.
    ErrorCode,
    /// A header name position.
    HeaderName,
    /// A rule id position.
    RuleId,
    /// A schema reference position.
    SchemaReference,
}

/// Every marker, in the order of the TypeScript `MARKERS` table.
pub const MARKERS: [Marker; 24] = [
    Marker::Refused,
    Marker::RefusedForm,
    Marker::Conflict,
    Marker::Reserved,
    Marker::Reason,
    Marker::ReasonedPolicy,
    Marker::Access,
    Marker::CsrfExemption,
    Marker::IdempotencyExemption,
    Marker::QueryException,
    Marker::UnknownKeysException,
    Marker::NodeMarker,
    Marker::DeriveEntry,
    Marker::Choice,
    Marker::Alternatives,
    Marker::Routes,
    Marker::Name,
    Marker::SchemaName,
    Marker::ScalarName,
    Marker::RightName,
    Marker::ErrorCode,
    Marker::HeaderName,
    Marker::RuleId,
    Marker::SchemaReference,
];

impl Marker {
    /// The `title` the authoring schemas write for the marker.
    #[must_use]
    pub const fn title(self) -> &'static str {
        match self {
            Self::Refused => "refused",
            Self::RefusedForm => "refused form",
            Self::Conflict => "conflict",
            Self::Reserved => "reserved",
            Self::Reason => "reason",
            Self::ReasonedPolicy => "reasoned policy",
            Self::Access => "access",
            Self::CsrfExemption => "csrf exemption",
            Self::IdempotencyExemption => "idempotency exemption",
            Self::QueryException => "query exception",
            Self::UnknownKeysException => "unknown keys exception",
            Self::NodeMarker => "node marker",
            Self::DeriveEntry => "derive entry",
            Self::Choice => "choice",
            Self::Alternatives => "alternatives",
            Self::Routes => "routes",
            Self::Name => "name",
            Self::SchemaName => "schema name",
            Self::ScalarName => "scalar name",
            Self::RightName => "right name",
            Self::ErrorCode => "error code",
            Self::HeaderName => "header name",
            Self::RuleId => "rule id",
            Self::SchemaReference => "schema reference",
        }
    }

    /// The marker a schema `title` names, or `None` for any other title.
    #[must_use]
    pub fn from_title(title: &str) -> Option<Self> {
        MARKERS.into_iter().find(|marker| marker.title() == title)
    }
}

/// Titles shown by editors (hover, completion) that no rule of the validate stage reads; a
/// file's root title (`seampact api file`) is not listed.
pub const EDITOR_TITLES: [&str; 14] = [
    "date",
    "duration",
    "meta fill",
    "node",
    "pack reference",
    "path",
    "schema",
    "scheme",
    "scheme kind",
    "size",
    "template",
    "unknown keys policy",
    "unknown query policy",
    "value source",
];

/// Names no map of the grammar admits as a key and no right name takes: a key that reaches the
/// prototype chain of a JavaScript reader. The loader refuses them as keys too
/// (`seampact/load/reserved-key`).
pub const RESERVED_NAMES: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// The title of a data position (ADR 0002 section 2): a payload, an example or a default, where
/// the grammar expects any value. There the loader writes null as `null`, replaces a mapping
/// holding only `$file`, and checks no scalar type. No rule of the validate stage reads it.
pub const DATA: &str = "data";

/// The pattern of a consumer extension key, `x-<prefix>-<key>` (ADR 0002 section 12), as the
/// authoring schemas write it under `patternProperties`.
pub const EXTENSION_KEY: &str = "^x-[a-z][a-z0-9]*-[a-z][a-z0-9]*(-[a-z0-9]+)*$";

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn markers_are_distinct_and_recognised() {
        let titles: HashSet<&str> = MARKERS.iter().map(|marker| marker.title()).collect();

        assert_eq!(titles.len(), MARKERS.len());

        for marker in MARKERS {
            assert_eq!(Marker::from_title(marker.title()), Some(marker));
        }

        assert_eq!(Marker::from_title("path"), None);
        assert_eq!(Marker::from_title("Refused"), None);
        assert_eq!(Marker::from_title(""), None);
    }

    #[test]
    fn editor_titles_and_data_are_no_markers() {
        for title in EDITOR_TITLES {
            assert_eq!(Marker::from_title(title), None, "{title}");
        }

        assert_eq!(Marker::from_title(DATA), None);
        assert!(!EDITOR_TITLES.contains(&DATA));
    }
}
