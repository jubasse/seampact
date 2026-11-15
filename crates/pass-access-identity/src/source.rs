//! Value sources in their IR form: this half reads the named forms only (a signature key, a
//! header use's `from`, a binding).

use seampact_diagnostics::InternalError;
use seampact_ir::{ValueSource, ValueSourceIn};

/// The named value sources this half reads.
pub(crate) const NAMED_SOURCES: &[&str] =
    &["path", "query", "header", "body", "principal", "scope"];

fn is_named_source(text: &str) -> bool {
    NAMED_SOURCES.contains(&text)
}

/// The IR form of a named value source (`path.workspaceId`, `principal.profile.id`).
///
/// # Errors
///
/// An internal error for a source that is not one of the named forms: the authoring schema has
/// checked each against its use.
pub(crate) fn access_identity_value_source(text: &str) -> Result<ValueSource, InternalError> {
    let named = text.split_once('.').and_then(|(kind, name)| {
        is_named_source(kind)
            .then(|| ValueSourceIn::known(kind))
            .flatten()
            .map(|location| (location, name))
    });

    let Some((location, name)) = named else {
        return Err(InternalError::new(format!(
            "access.identity reads named value sources only ({}): '{text}'",
            NAMED_SOURCES.join(", ")
        )));
    };

    Ok(ValueSource {
        r#in: location,
        name: Some(name.to_owned()),
        prefix_bits: None,
    })
}
