//! A failure under a marked definition, by the marker's role.

use seampact_authoring::{Marker, RESERVED_NAMES};
use seampact_diagnostics::{quote, quote_text};
use seampact_json::JsonValue;

use crate::ajv_error::{AjvError, AjvKind};
use crate::keyword_problems::{RefusedFormOf, reason_required, refused_keyword, reserved_name};
use crate::pointer_text::{last_segment, subject_of, where_};
use crate::problem::{Problem, description};
use crate::roles::{Role, holder_form, role_of};
use crate::rules::ValidateRule;
use crate::sentence::{lower_first, sentence};

/// The values of a policy mapping written as a bare string.
const POLICY_REASONS: [&str; 2] = ["ignore", "keep"];

/// The problem of a failure under `marker`'s definition; `None` falls back on the keyword.
pub(crate) fn convert_marked(error: &AjvError, marker: Marker) -> Option<Problem> {
    let key = last_segment(&error.instance_path);
    let pointer = error.instance_path.clone();
    let is_not = error.kind == AjvKind::Not;
    let is_required = matches!(error.kind, AjvKind::Required { .. });

    match role_of(marker) {
        Role::Refused => is_not.then(|| refused_keyword(error, RefusedFormOf::WholeKeyword)),
        Role::RefusedForm => is_not.then(|| refused_keyword(error, RefusedFormOf::KeywordForm)),
        Role::Conflict => is_not.then(|| Problem {
            rule: ValidateRule::ConflictingKeywords,
            pointer,
            message: format!(
                "{} cannot be written here: {}.",
                quote_text(&key),
                description(error)
            ),
            fix: format!(
                "Remove {}, or the keyword it conflicts with.",
                quote_text(&key)
            ),
        }),
        Role::Reserved => is_not.then(|| Problem {
            rule: ValidateRule::InvalidName,
            pointer,
            message: sentence(&description(error)),
            fix: "Choose another prefix.".to_owned(),
        }),
        Role::Reason => Some(reason_required(&pointer, &subject_of(&pointer), None)),
        Role::ReasonedPolicy => reasoned_policy(error, &key),
        Role::ReasonHolder(holder) => is_required.then(|| {
            reason_required(
                &pointer,
                &subject_of(&pointer),
                Some(format!("Write {}.", holder_form(holder, &key))),
            )
        }),
        Role::NodeMarker => is_required.then(|| Problem {
            rule: ValidateRule::MissingKeyword,
            pointer: pointer.clone(),
            message: format!(
                "Node {} states no kind: a node is a route ('method'), a collection or a single ('kind'), or a relay route ('relays') (ADR 0002 section 6).",
                where_(&pointer)
            ),
            fix: "Add 'method', 'kind: collection', 'kind: single' or, in a surface root's routes, 'relays'."
                .to_owned(),
        }),
        Role::DeriveEntry => is_required.then(|| Problem {
            rule: ValidateRule::MissingKeyword,
            pointer,
            message: "A derive entry needs at least one effect (ADR 0002 section 2).".to_owned(),
            fix: "Add 'declareRight', 'require' or 'attachErrors'.".to_owned(),
        }),
        Role::Choice => is_required.then(|| Problem {
            rule: ValidateRule::MissingKeyword,
            pointer: pointer.clone(),
            message: format!("{} needs {}.", subject_of(&pointer), description(error)),
            fix: format!("Add {}.", description(error)),
        }),
        Role::Alternatives => matches!(error.kind, AjvKind::Type { .. }).then(|| Problem {
            rule: ValidateRule::WrongType,
            pointer: pointer.clone(),
            message: format!("{} must be {}.", subject_of(&pointer), description(error)),
            fix: format!("Write {}.", description(error)),
        }),
        Role::Routes => None,
        Role::Name => convert_name(error, marker, &pointer),
    }
}

fn reasoned_policy(error: &AjvError, key: &str) -> Option<Problem> {
    let pointer = &error.instance_path;

    if let JsonValue::String(text) = &error.data
        && POLICY_REASONS.contains(&text.as_str())
    {
        return Some(reason_required(
            pointer,
            &format!("'{key}: {text}'"),
            Some(format!(
                "Write the reason as a string: {key}: {{ {text}: \"<reason>\" }}."
            )),
        ));
    }

    if error.kind != AjvKind::Not {
        return None;
    }

    Some(Problem {
        rule: ValidateRule::InvalidValue,
        pointer: pointer.clone(),
        message: format!(
            "{} takes no string here, only a reasoned exception.",
            subject_of(pointer)
        ),
        fix: format!("Write {key}: {{ ignore: \"<reason>\" }} or {key}: {{ keep: \"<reason>\" }}."),
    })
}

fn convert_name(error: &AjvError, marker: Marker, pointer: &str) -> Option<Problem> {
    if error.kind == AjvKind::Not
        && let JsonValue::String(text) = &error.data
        && RESERVED_NAMES.contains(&text.as_str())
    {
        return Some(Problem {
            rule: ValidateRule::InvalidName,
            pointer: pointer.to_owned(),
            message: reserved_name(text),
            fix: format!("Write another {}.", marker.title()),
        });
    }

    let AjvKind::Pattern { pattern } = &error.kind else {
        return None;
    };

    Some(Problem {
        rule: ValidateRule::InvalidName,
        pointer: pointer.to_owned(),
        message: format!(
            "{} is not a valid {}: {}.",
            quote(&error.data),
            marker.title(),
            lower_first(&description(error))
        ),
        fix: format!("Write a {} that matches {pattern}.", marker.title()),
    })
}
