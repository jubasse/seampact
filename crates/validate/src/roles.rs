//! How the converter treats a marked definition: the role of each marker.

use seampact_authoring::Marker;

/// The role of a marker; a marker without a role is a compile error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    Refused,
    RefusedForm,
    Conflict,
    Reserved,
    Reason,
    ReasonedPolicy,
    ReasonHolder(HolderMarker),
    NodeMarker,
    DeriveEntry,
    Choice,
    Alternatives,
    Routes,
    Name,
}

/// The markers of a mapping whose missing key is a missing reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HolderMarker {
    Access,
    CsrfExemption,
    IdempotencyExemption,
    QueryException,
    UnknownKeysException,
}

/// The role of `marker`.
#[must_use]
pub(crate) const fn role_of(marker: Marker) -> Role {
    match marker {
        Marker::Refused => Role::Refused,
        Marker::RefusedForm => Role::RefusedForm,
        Marker::Conflict => Role::Conflict,
        Marker::Reserved => Role::Reserved,
        Marker::Reason => Role::Reason,
        Marker::ReasonedPolicy => Role::ReasonedPolicy,
        Marker::Access => Role::ReasonHolder(HolderMarker::Access),
        Marker::CsrfExemption => Role::ReasonHolder(HolderMarker::CsrfExemption),
        Marker::IdempotencyExemption => Role::ReasonHolder(HolderMarker::IdempotencyExemption),
        Marker::QueryException => Role::ReasonHolder(HolderMarker::QueryException),
        Marker::UnknownKeysException => Role::ReasonHolder(HolderMarker::UnknownKeysException),
        Marker::NodeMarker => Role::NodeMarker,
        Marker::DeriveEntry => Role::DeriveEntry,
        Marker::Choice => Role::Choice,
        Marker::Alternatives => Role::Alternatives,
        Marker::Routes => Role::Routes,
        Marker::Name
        | Marker::SchemaName
        | Marker::ScalarName
        | Marker::RightName
        | Marker::ErrorCode
        | Marker::HeaderName
        | Marker::RuleId
        | Marker::SchemaReference => Role::Name,
    }
}

/// The reasoned form of such a mapping, for the fix, spelt with the key that holds it
/// (`unknownQuery` or `conventions.query.unknownKeys` for a query exception); the marker's own
/// keyword when `key` is not a plain keyword.
#[must_use]
pub(crate) fn holder_form(marker: HolderMarker, key: &str) -> String {
    let (fallback, form): (&str, fn(&str) -> String) = match marker {
        HolderMarker::Access => ("access", |key| {
            format!("{key}: {{ public: \"<reason>\" }} or {key}: {{ optionalAuth: \"<reason>\" }}")
        }),
        HolderMarker::CsrfExemption => ("csrf", |key| format!("{key}: {{ exempt: \"<reason>\" }}")),
        HolderMarker::IdempotencyExemption => ("idempotency", |key| {
            format!("{key}: {{ exempt: \"<reason>\" }}")
        }),
        HolderMarker::QueryException => ("unknownQuery", |key| {
            format!("{key}: {{ ignore: \"<reason>\" }}")
        }),
        HolderMarker::UnknownKeysException => ("unknownKeys", |key| {
            format!("{key}: {{ ignore: \"<reason>\" }} or {key}: {{ keep: \"<reason>\" }}")
        }),
    };

    form(if is_letters(key) { key } else { fallback })
}

/// Whether `text` is one or more ASCII letters.
#[must_use]
pub(crate) fn is_letters(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|character| character.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_holder_form_names_the_key_or_falls_back_on_its_keyword() {
        assert_eq!(
            holder_form(HolderMarker::Access, "access"),
            "access: { public: \"<reason>\" } or access: { optionalAuth: \"<reason>\" }"
        );
        assert_eq!(
            holder_form(
                HolderMarker::QueryException,
                "conventions.query.unknownKeys"
            ),
            "unknownQuery: { ignore: \"<reason>\" }"
        );
        assert_eq!(
            holder_form(HolderMarker::CsrfExemption, ""),
            "csrf: { exempt: \"<reason>\" }"
        );
    }

    #[test]
    fn only_the_five_reason_markers_are_holders() {
        assert_eq!(
            role_of(Marker::Access),
            Role::ReasonHolder(HolderMarker::Access)
        );
        assert_eq!(role_of(Marker::Reason), Role::Reason);
        assert_eq!(role_of(Marker::SchemaName), Role::Name);
    }
}
