//! The problems of unknown, refused and reserved keys, and of safety exceptions without a reason.

use seampact_authoring::{RESERVED_NAMES, schema_keyword};
use seampact_diagnostics::quote_text;
use seampact_json::escape_pointer;
use serde_json::Value;

use crate::ajv_error::AjvError;
use crate::pointer_text::{last_segment, where_};
use crate::problem::{Problem, known_keywords};
use crate::roles::is_letters;
use crate::rules::ValidateRule;
use crate::sentence::sentence;
use crate::suggest::closest_keyword;

/// Longer keys get no closest-keyword search.
const SUGGEST_LIMIT: usize = 64;

/// The most keywords a fix lists.
const LISTED_KEYWORDS_LIMIT: usize = 12;

const EXTENSION_PREFIX: &str = "x-";

const NAME_SCHEMA_DESCRIPTION_FALLBACK: &str = "a valid key";

/// Whether the failure is at the root of a pack file, which refuses code and unknown keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackRoot {
    /// The document is a pack.
    Pack,
    /// Any other document.
    NotPack,
}

/// A reserved name, for a key or a right name.
#[must_use]
pub(crate) fn reserved_name(name: &str) -> String {
    format!(
        "{} is a reserved name: it reaches the prototype of a JavaScript object, so no key or right name may be {}.",
        quote_text(name),
        RESERVED_NAMES.join(", ")
    )
}

/// A key the schema does not list.
pub(crate) fn unknown_keyword(error: &AjvError, key: &str, pack_root: PackRoot) -> Problem {
    let pointer = format!("{}/{}", error.instance_path, escape_pointer(key));
    let rule = ValidateRule::UnknownKeyword;
    let at_pack_root = pack_root == PackRoot::Pack && error.instance_path.is_empty();
    let mut message = format!(
        "{} is not a keyword of {}.",
        quote_text(key),
        where_(&error.instance_path)
    );

    if at_pack_root {
        message = format!(
            "{} is not a key of a pack: a pack is data only, its manifest, catalogues, conventions, formats, extensions, lint and derive (ADR 0008).",
            quote_text(key)
        );
    } else if key.starts_with(EXTENSION_PREFIX) {
        message = format!(
            "{} is not an extension key of {}: an extension is written x-<prefix>-<key> where its declaration's 'at' allows it.",
            quote_text(key),
            where_(&error.instance_path)
        );
    }

    if at_pack_root && key == "packs" {
        return Problem {
            rule,
            pointer,
            message,
            fix: "List the packs this pack builds on in 'pack.extends'.".to_owned(),
        };
    }

    let known = known_keywords(error);
    let closest = if key.encode_utf16().count() <= SUGGEST_LIMIT {
        closest_keyword(key, &known)
    } else {
        None
    };
    let fix = if let Some(closest) = closest {
        format!("Did you mean '{closest}'?")
    } else {
        let listed = if !known.is_empty() && known.len() <= LISTED_KEYWORDS_LIMIT {
            format!("; the keywords here are {}", known.join(", "))
        } else {
            String::new()
        };

        format!("Remove {}{listed}.", quote_text(key))
    };

    Problem {
        rule,
        pointer,
        message,
        fix,
    }
}

/// A JSON Schema keyword (or a refused form of one) written in a schema.
pub(crate) fn refused_keyword(error: &AjvError, form: RefusedFormOf) -> Problem {
    let keyword = last_segment(&error.instance_path);
    let entry = schema_keyword(&keyword);
    let decided = match form {
        RefusedFormOf::WholeKeyword => entry.map(|entry| (entry.reason, entry.fix)),
        RefusedFormOf::KeywordForm => entry
            .and_then(|entry| entry.refused_form)
            .map(|refused| (refused.reason, refused.fix)),
    };
    let rule = ValidateRule::RefusedKeyword;
    let pointer = error.instance_path.clone();

    let Some((reason, fix)) = decided else {
        return Problem {
            rule,
            pointer,
            message: format!("{} is refused in a schema.", quote_text(&keyword)),
            fix: format!("Remove {}.", quote_text(&keyword)),
        };
    };
    let message = match form {
        RefusedFormOf::KeywordForm => format!(
            "This form of '{keyword}' is refused in a schema: {reason} (ADR 0003 section 1)."
        ),
        RefusedFormOf::WholeKeyword => {
            format!("'{keyword}' is refused in a schema: {reason} (ADR 0003 section 1).")
        }
    };

    Problem {
        rule,
        pointer,
        message,
        fix: sentence(fix),
    }
}

/// Whether a refused keyword is refused whole or only in one of its forms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RefusedFormOf {
    /// The keyword is refused whatever its value.
    WholeKeyword,
    /// One form of a kept keyword is refused.
    KeywordForm,
}

/// A key the name schema of its mapping refuses.
pub(crate) fn invalid_key(error: &AjvError, name: &str) -> Problem {
    let schema = error.schema.and_then(Value::as_object);
    let what = schema
        .and_then(|schema| schema.get("description"))
        .and_then(Value::as_str)
        .unwrap_or(NAME_SCHEMA_DESCRIPTION_FALLBACK);
    let pointer = format!("{}/{}", error.instance_path, escape_pointer(name));
    let rule = ValidateRule::InvalidName;

    if RESERVED_NAMES.contains(&name) {
        return Problem {
            rule,
            pointer,
            message: reserved_name(name),
            fix: "Rename it.".to_owned(),
        };
    }

    if name == "$include"
        && crate::problem::marker_of(error) == Some(seampact_authoring::Marker::Routes)
    {
        return Problem {
            rule,
            pointer,
            message: format!(
                "'$include' cannot be a key of {}: every child of a routes map is named in its parent (ADR 0002 section 2).",
                where_(&error.instance_path)
            ),
            fix:
                "Write the child's name, then '$include' under it: '<name>: { $include: <path> }'."
                    .to_owned(),
        };
    }

    let pattern = schema
        .and_then(|schema| schema.get("pattern"))
        .map_or_else(|| "undefined".to_owned(), javascript_text);

    Problem {
        rule,
        pointer,
        message: format!("{} is not {what}.", quote_text(name)),
        fix: format!("Rename it to match {pattern}."),
    }
}

// `String(value)` of a schema member: a string as is, any other value as JSON.
fn javascript_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// A safety exception without its reason.
pub(crate) fn reason_required(pointer: &str, what: &str, fix: Option<String>) -> Problem {
    Problem {
        rule: ValidateRule::ReasonRequired,
        pointer: pointer.to_owned(),
        message: format!(
            "{what} needs a reason: a safety exception states why, in a non-empty string (A40)."
        ),
        fix: fix.unwrap_or_else(|| {
            format!(
                "Write the reason as a string: {}.",
                example_for(&last_segment(pointer))
            )
        }),
    }
}

/// The reasoned spelling of a key; only grammar keys reach it (`public`, `exempt`, `guest`).
#[must_use]
pub(crate) fn example_for(key: &str) -> String {
    match key {
        "ignore" | "keep" => format!("{{ {key}: \"<reason>\" }}"),
        "unknownQuery" | "unknownKeys" => "{ ignore: \"<reason>\" }".to_owned(),
        _ if is_letters(key) => format!("{key}: \"<reason>\""),
        _ => "\"<reason>\"".to_owned(),
    }
}
