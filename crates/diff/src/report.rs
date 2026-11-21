//! The text form of a diff report: one line per change, then the deprecations, then each gate
//! failure in the CLI's diagnostic form (`<code>: <message> Fix: <fix>`), then the gate outcome.
//! A refused diff prints its refusals in the same diagnostic form.

use seampact_diff_table::{
    DeprecationEntry, DiffChange, DiffClassification, DiffCode, DiffComparison, DiffPosition,
    DiffResult, DiffValue,
};
use seampact_json::{JsonValue, js_text_of};

use crate::DiffError;
use crate::gate::breaks_text;
use crate::walk_refusals::api_version_text;

/// The operations column of a change no operation reaches.
const NO_OPERATION: &str = "-";

/// The report `seampact diff` prints for `result`.
///
/// # Errors
///
/// Never today; the signature keeps the room the TypeScript's report has none for.
pub fn format_diff_report(result: &DiffResult) -> Result<String, DiffError> {
    let comparison = match result {
        DiffResult::Refused(refusals) => {
            let texts: Vec<String> = refusals
                .iter()
                .map(|refusal| diagnostic_line(refusal.code, &refusal.message, &refusal.fix))
                .collect();

            return Ok(lines(&texts));
        }
        DiffResult::Compared(comparison) => comparison,
    };

    Ok(compared_report(comparison))
}

fn compared_report(comparison: &DiffComparison) -> String {
    let header = format!(
        "{} {}: compat.policy {} (before {}, after {}), gate {}",
        comparison.api,
        api_version_text(&comparison.after.version),
        comparison.policy.applied.as_str(),
        comparison.policy.before.as_str(),
        comparison.policy.after.as_str(),
        comparison.settings.gate.as_str(),
    );
    let change_lines: Vec<String> = if comparison.changes.is_empty() {
        vec!["no change".to_owned()]
    } else {
        comparison.changes.iter().map(change_line).collect()
    };
    let failure_count = comparison.gate.failures.len();
    let outcome = if comparison.gate.passed {
        "gate passed".to_owned()
    } else {
        format!("gate failed: {failure_count} failure(s)")
    };
    let mut texts = vec![header];

    texts.extend(change_lines);
    texts.extend(comparison.deprecations.iter().map(deprecation_line));
    texts.extend(
        comparison
            .gate
            .failures
            .iter()
            .map(|failure| diagnostic_line(failure.code, &failure.message, &failure.fix)),
    );
    texts.push(outcome);

    lines(&texts)
}

fn lines(texts: &[String]) -> String {
    format!("{}\n", texts.join("\n"))
}

fn change_line(change: &DiffChange) -> String {
    let label = if change.classification == DiffClassification::Breaking {
        format!("breaking {}", breaks_text(&change.breaks))
    } else {
        change.classification.as_str().to_owned()
    };
    let operations = if change.operations.is_empty() {
        NO_OPERATION.to_owned()
    } else {
        change.operations.join(",")
    };
    let position = if change.position == DiffPosition::None {
        String::new()
    } else {
        format!(" {}", change.position.as_str())
    };
    let values = values_text(change.before.as_ref(), change.after.as_ref());
    let cause = change
        .cause
        .as_ref()
        .map_or_else(String::new, |cause| format!(" [pack {}]", cause.pack));
    let exemption = change.exemption.map_or_else(String::new, |found| {
        format!(" [exempt: {}]", found.as_str())
    });

    format!(
        "{label} {operations}{position} {}: {} {}{values}{cause}{exemption}",
        change.pointer,
        change.kind.as_str(),
        change.case_name,
    )
}

/// ` (before -> after)`, or ` (value)` for one side.
///
/// A `null` before is read as absent when only one side shows, as the TypeScript's `before ?? after`.
fn values_text(before: Option<&DiffValue>, after: Option<&DiffValue>) -> String {
    if let (Some(before_value), Some(after_value)) = (before, after) {
        return format!(
            " ({} -> {})",
            value_text(before_value),
            value_text(after_value)
        );
    }

    let value = match before {
        Some(DiffValue::Null) | None => after,
        Some(_) => before,
    };

    value.map_or_else(String::new, |shown| format!(" ({})", value_text(shown)))
}

/// `String(value)` of a report value.
fn value_text(value: &DiffValue) -> String {
    match value {
        DiffValue::Text(text) => text.clone(),
        DiffValue::Number(number) => js_text_of(Some(&JsonValue::Number(number.clone()))),
        DiffValue::Bool(flag) => flag.to_string(),
        DiffValue::Null => "null".to_owned(),
    }
}

fn deprecation_line(entry: &DeprecationEntry) -> String {
    match entry {
        DeprecationEntry::Operation {
            operation,
            status,
            since,
            sunset,
            successor,
            days_to_sunset,
            past_sunset,
            ..
        } => {
            let successor_text = successor
                .as_ref()
                .map_or_else(String::new, |found| format!(", successor {found}"));
            let sunset_text = if *past_sunset {
                "past sunset".to_owned()
            } else {
                format!("{days_to_sunset} days to sunset")
            };

            format!(
                "deprecation {operation}: {}, since {since}, sunset {sunset} ({sunset_text}){successor_text}",
                status.as_str()
            )
        }
        DeprecationEntry::Schema { schema, status, .. } => {
            format!("deprecation schema {schema}: {}", status.as_str())
        }
        DeprecationEntry::Property {
            schema,
            property,
            status,
            ..
        } => format!(
            "deprecation property {schema}.{property}: {}",
            status.as_str()
        ),
    }
}

fn diagnostic_line(code: DiffCode, message: &str, fix: &str) -> String {
    format!("{}: {message} Fix: {fix}", code.as_str())
}

#[cfg(test)]
mod tests {
    use seampact_json::JsonNumber;

    use super::*;

    fn number(value: f64) -> DiffValue {
        DiffValue::Number(JsonNumber::from_f64(value).unwrap_or_else(|| panic!("{value}")))
    }

    #[test]
    fn a_null_before_is_read_as_absent_when_only_one_side_shows() {
        assert_eq!(values_text(Some(&DiffValue::Null), None), "");
        assert_eq!(values_text(None, Some(&DiffValue::Null)), " (null)");
        assert_eq!(
            values_text(
                Some(&DiffValue::Null),
                Some(&DiffValue::Text("x".to_owned()))
            ),
            " (null -> x)"
        );
        assert_eq!(values_text(Some(&DiffValue::Bool(true)), None), " (true)");
    }

    #[test]
    fn a_number_is_written_as_javascript_writes_it() {
        assert_eq!(
            values_text(Some(&number(1e21)), Some(&number(0.1))),
            " (1e+21 -> 0.1)"
        );
        assert_eq!(values_text(None, Some(&number(-0.0))), " (0)");
    }

    #[test]
    fn a_report_ends_with_one_newline() {
        assert_eq!(lines(&["a".to_owned(), "b".to_owned()]), "a\nb\n");
    }
}
