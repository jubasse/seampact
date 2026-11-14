//! Failures turned into located diagnostics: one per problem, never one per failed subschema.
//!
//! The authoring schemas mark the definitions whose failures have their own rule by a title of
//! `MARKERS`; everything else falls back on the keyword. Every authored value reaches a message or
//! a fix through `quote`, which escapes control, bidi and line-separator characters and bounds the
//! length: a contract file is untrusted input, and a message is printed to a terminal.

use std::collections::HashSet;

use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, InternalError, Severity, mapping_keys_hint,
    quote, quote_text,
};
use seampact_json::{JsonValue, escape_pointer, stringify_json};

use crate::ajv_error::{AjvError, AjvKind};
use crate::keyword_problems::{PackRoot, invalid_key, unknown_keyword};
use crate::marked::convert_marked;
use crate::pointer_text::subject_of;
use crate::problem::{Problem, description, mapping_keys_of, marker_of};
use crate::rules::ValidateRule;
use crate::sentence::lower_first;

/// Converting stops after this many diagnostics: a file far from the grammar gives a bounded
/// report.
pub(crate) const MAX_DIAGNOSTICS: usize = 200;

const INCLUDE_KEY: &str = "$include";

/// What the conversion knows of the document.
#[derive(Debug, Clone)]
pub(crate) struct ConvertContext {
    pub layer: DiagnosticLayer,
    /// The pack root refuses code and unknown keys (ADR 0008, SCN-047).
    pub pack_root: PackRoot,
}

fn convert_one(
    error: &AjvError,
    context: &ConvertContext,
) -> Result<Option<Problem>, InternalError> {
    match &error.kind {
        AjvKind::AdditionalProperties { property } => {
            return Ok(Some(unknown_keyword(error, property, context.pack_root)));
        }
        AjvKind::PropertyNames { property_name } => {
            return Ok(Some(invalid_key(error, property_name)));
        }
        _ => {}
    }

    if let Some(marker) = marker_of(error)
        && let Some(marked) = convert_marked(error, marker)
    {
        return Ok(Some(marked));
    }

    let pointer = error.instance_path.clone();
    let subject = subject_of(&pointer);

    let problem = match &error.kind {
        AjvKind::Required { missing_property } => Problem {
            rule: ValidateRule::MissingKeyword,
            pointer,
            message: format!("{subject} needs '{missing_property}'."),
            fix: format!("Add '{missing_property}'."),
        },
        AjvKind::Type { types } => {
            let type_text = article(types);

            Problem {
                rule: ValidateRule::WrongType,
                pointer,
                message: format!("{subject} must be {type_text}."),
                fix: format!(
                    "Write {type_text}{}.",
                    mapping_keys_hint(&mapping_keys_of(error, &type_text))
                ),
            }
        }
        AjvKind::MaxProperties { limit } => max_properties(error, *limit, &subject),
        AjvKind::Const { allowed_value } => {
            let allowed = stringify_json(allowed_value);

            Problem {
                rule: ValidateRule::InvalidValue,
                pointer,
                message: format!(
                    "{subject} is {}; its one value is {allowed}.",
                    quote(&error.data)
                ),
                fix: format!("Write {allowed}, or remove {subject}."),
            }
        }
        AjvKind::Not => Problem {
            rule: ValidateRule::InvalidValue,
            pointer,
            message: format!("{subject} cannot be written here."),
            fix: format!("Remove {subject}."),
        },
        AjvKind::AdditionalProperties { .. } | AjvKind::PropertyNames { .. } => {
            return Err(InternalError::new(
                "an unknown or invalid key is converted before the marker lookup",
            ));
        }
        AjvKind::Enum { .. } | AjvKind::Pattern { .. } | AjvKind::Other { .. } => {
            invalid_value(error)
        }
    };

    Ok(Some(problem))
}

// `$include` beside the keys is not counted (the schema raises the bound by one for it).
fn max_properties(error: &AjvError, limit: u64, subject: &str) -> Problem {
    let all: Vec<&String> = match &error.data {
        JsonValue::Object(members) => members.keys().collect(),
        _ => Vec::new(),
    };
    let keys: Vec<&String> = all
        .iter()
        .copied()
        .filter(|key| key.as_str() != INCLUDE_KEY)
        .collect();
    let allowed = i128::from(limit) - i128::try_from(all.len() - keys.len()).unwrap_or_default();
    let shown_keys = keys
        .iter()
        .map(|key| quote_text(key))
        .collect::<Vec<_>>()
        .join(", ");
    let takes = if allowed == 1 {
        "one key".to_owned()
    } else {
        format!("at most {allowed} keys")
    };
    let keep = if allowed == 1 {
        "one of them".to_owned()
    } else {
        format!("{allowed} of them")
    };

    Problem {
        rule: ValidateRule::ConflictingKeywords,
        pointer: error.instance_path.clone(),
        message: format!("{subject} takes {takes}, not {shown_keys}."),
        fix: format!("Keep {keep}."),
    }
}

/// The JSON type names as a message says them: `object` is a mapping, `array` a list.
fn article(types: &str) -> String {
    types
        .split(',')
        .map(|name| match name {
            "object" => "a mapping",
            "array" => "a list",
            "string" => "a string",
            "integer" => "an integer",
            "number" => "a number",
            "boolean" => "a boolean",
            "null" => "null",
            other => other,
        })
        .collect::<Vec<_>>()
        .join(" or ")
}

fn invalid_value(error: &AjvError) -> Problem {
    let subject = subject_of(&error.instance_path);
    let pointer = error.instance_path.clone();
    let rule = ValidateRule::InvalidValue;

    match &error.kind {
        AjvKind::Enum { allowed_values } => {
            let allowed: Vec<String> = allowed_values.iter().map(stringify_json).collect();

            Problem {
                rule,
                pointer,
                message: format!(
                    "{subject} is {}, not one of its values.",
                    quote(&error.data)
                ),
                fix: format!("Write one of {}.", allowed.join(", ")),
            }
        }
        AjvKind::Pattern { pattern } => {
            let described = description(error);
            let what = lower_first(&if described.is_empty() {
                format!("a value matching {pattern}")
            } else {
                described
            });

            Problem {
                rule,
                pointer,
                message: format!("{subject} is {}, which is not {what}.", quote(&error.data)),
                fix: format!("Write {what}."),
            }
        }
        AjvKind::Other { message } => {
            let named = if subject == "The file" {
                "the file"
            } else {
                subject.as_str()
            };

            // The message of the remaining keywords names schema facts only (a bound, a length).
            Problem {
                rule,
                pointer,
                message: format!("{subject} {message}."),
                fix: format!("Change {named} so that it {message}."),
            }
        }
        _ => Problem {
            rule,
            pointer,
            message: format!("{subject} is invalid."),
            fix: format!("Change {subject} so that it is valid."),
        },
    }
}

// Whether `pointer` is one of `keys` or lies under one, walking up its parents.
fn under(pointer: &str, keys: &HashSet<String>) -> bool {
    let mut current = pointer;

    loop {
        if keys.contains(current) {
            return true;
        }

        let Some((parent, _)) = current.rsplit_once('/') else {
            return false;
        };

        current = parent;
    }
}

/// The failures of one document as diagnostics of one layer, at most [`MAX_DIAGNOSTICS`].
///
/// # Errors
///
/// An [`InternalError`] when a failure cannot be converted (a bug).
pub(crate) fn convert_errors(
    errors: &[AjvError],
    context: &ConvertContext,
) -> Result<Vec<Diagnostic>, InternalError> {
    let mut seen: HashSet<(ValidateRule, String, String)> = HashSet::new();
    let mut out = Vec::new();
    // A key refused by its name is one problem: its value is not checked further.
    let bad_keys: HashSet<String> = errors
        .iter()
        .filter_map(|error| match &error.kind {
            AjvKind::PropertyNames { property_name } => Some(format!(
                "{}/{}",
                error.instance_path,
                escape_pointer(property_name)
            )),
            _ => None,
        })
        .collect();

    for error in errors {
        if out.len() >= MAX_DIAGNOSTICS {
            break;
        }

        let is_name_error = matches!(error.kind, AjvKind::PropertyNames { .. });

        if !is_name_error && !bad_keys.is_empty() && under(&error.instance_path, &bad_keys) {
            continue;
        }

        let Some(problem) = convert_one(error, context)? else {
            continue;
        };

        if !seen.insert((
            problem.rule,
            problem.pointer.clone(),
            problem.message.clone(),
        )) {
            continue;
        }

        out.push(Diagnostic {
            severity: Severity::Error,
            rule: problem.rule.rule_id(),
            message: problem.message,
            fix: problem.fix,
            origin: DiagnosticOrigin {
                layer: context.layer.clone(),
                pointer: problem.pointer,
                api: None,
            },
            related: Vec::new(),
        });
    }

    Ok(out)
}
