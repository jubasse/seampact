//! The rules of the subject of a field right and of a sort key.

use seampact_json::{JsonObject, is_text, js_text_of, object_of, text_of};

use super::json_members::entry;
use super::open_values::is_known;
use super::violation::{IrInvariantId, Violations};
use crate::{IrError, union_tags};

/// The members a field right with `always` cannot have.
const ALWAYS_EXCLUDED: [&str; 3] = ["subject", "inputPolicy", "params"];

/// The union that decides whether a right reads a subject.
const RIGHT_SUBJECT_UNION: &str = "RightSubject";

/// The subject kind that reads nothing on the request.
const NO_SUBJECT_KIND: &str = "none";

// Whether the right's subject kind needs a subject on the request: every known one but `none`.
// `None` for a right the document does not hold or an unknown kind, which the reader names.
fn subject_needed(
    rights: &JsonObject,
    right: Option<&seampact_json::JsonValue>,
) -> Result<Option<bool>, IrError> {
    let declaration = object_of(entry(rights, right));
    let subject = object_of(declaration.and_then(|declaration| declaration.get("subject")));
    let Some(kind) = text_of(subject.and_then(|subject| subject.get("kind"))) else {
        return Ok(None);
    };
    let Some(union) = union_tags(RIGHT_SUBJECT_UNION) else {
        return Err(IrError::BrokenSchemas {
            what: format!("no IR union {RIGHT_SUBJECT_UNION}"),
        });
    };

    if !union.known_tags.contains(&kind) {
        return Ok(None);
    }

    Ok(Some(kind != NO_SUBJECT_KIND))
}

fn check_subject_presence(
    value: &JsonObject,
    pointer: &str,
    rights: &JsonObject,
    id: IrInvariantId,
    out: &mut Violations,
) -> Result<(), IrError> {
    let Some(needed) = subject_needed(rights, value.get("right"))? else {
        return Ok(());
    };

    if needed == value.contains_key("subject") {
        return Ok(());
    }

    let right = js_text_of(value.get("right"));
    let consequence = if needed {
        "reads a subject: 'subject' is required"
    } else {
        "has no subject: 'subject' is absent"
    };

    out.fail(id, pointer, format!("The right '{right}' {consequence}."));

    Ok(())
}

/// A field right that is always absent needs no decide call: an output right with nothing to
/// decide on.
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when the embedded schemas lack what the rule reads.
pub(super) fn check_field_right(
    value: &JsonObject,
    pointer: &str,
    rights: &JsonObject,
    out: &mut Violations,
) -> Result<(), IrError> {
    if !value.contains_key("always") {
        return check_subject_presence(
            value,
            pointer,
            rights,
            IrInvariantId::FieldRightAlways,
            out,
        );
    }

    if !is_known("FieldRight", "always", value.get("always"))? {
        return Ok(());
    }

    let excluded = ALWAYS_EXCLUDED
        .iter()
        .any(|member| value.contains_key(member));

    if !is_text(value.get("direction"), "output") || excluded {
        out.fail(
            IrInvariantId::FieldRightAlways,
            pointer,
            "A field right with 'always' is an output right without 'subject', 'inputPolicy' or 'params'."
                .to_owned(),
        );
    }

    Ok(())
}

/// A sort key has `params` and `subject` only with `right`, and a subject read on the request.
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when the embedded schemas lack what the rule reads.
pub(super) fn check_sort_key(
    value: &JsonObject,
    pointer: &str,
    rights: &JsonObject,
    out: &mut Violations,
) -> Result<(), IrError> {
    if !value.contains_key("right") {
        if value.contains_key("params") || value.contains_key("subject") {
            out.fail(
                IrInvariantId::SortKeyRight,
                pointer,
                "A sort key has 'params' and 'subject' only with 'right'.".to_owned(),
            );
        }

        return Ok(());
    }

    check_subject_presence(value, pointer, rights, IrInvariantId::SortKeyRight, out)?;

    let subject = object_of(value.get("subject"));
    let source = object_of(subject.and_then(|subject| subject.get("source")));

    if is_text(source.and_then(|source| source.get("in")), "holderField") {
        out.fail(
            IrInvariantId::SortKeyRight,
            &format!("{pointer}/subject/source"),
            "A sort key's subject is read on the request, never from a holder field.".to_owned(),
        );
    }

    Ok(())
}
