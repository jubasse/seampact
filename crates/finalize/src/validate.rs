//! The output check of finalize: the built IR against the strict IR JSON Schema and the IR
//! invariants, and the side table against its schema.
//!
//! A failure means a pass wrote a member it should not have, so it is an internal error naming
//! the api, the pointer and the rule, never a diagnostic for the author.

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::SourceMap;
use seampact_ir_check::{IrCheckFailure, check_source_map, check_strict_ir};
use seampact_json::JsonValue;

/// An internal error lists at most this many failures, then how many more there are.
const LISTED_FAILURE_LIMIT: usize = 10;
const OPERATION_POINTER_PREFIX: &str = "/operations/";

// The id of the operation a pointer is inside, so a pass author finds it without counting sorted operations.
fn operation_id_at(candidate: &JsonValue, pointer: &str) -> Option<String> {
    let rest = pointer.strip_prefix(OPERATION_POINTER_PREFIX)?;
    let index_text = rest.split('/').next()?;

    if index_text.is_empty() || !index_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }

    let JsonValue::Object(root) = candidate else {
        return None;
    };
    let Some(JsonValue::Array(operations)) = root.get("operations") else {
        return None;
    };
    let Some(JsonValue::Object(operation)) = operations.get(index_text.parse::<usize>().ok()?)
    else {
        return None;
    };

    match operation.get("id") {
        Some(JsonValue::String(id)) => Some(id.clone()),
        _ => None,
    }
}

// The rule, pointer and detail of a failure.
fn parts_of(failure: &IrCheckFailure) -> (String, &str, Option<String>) {
    match failure {
        IrCheckFailure::Schema {
            keyword,
            pointer,
            message,
        } => (
            format!("schema '{keyword}'"),
            pointer,
            Some(message.clone()),
        ),
        IrCheckFailure::UnknownMember { pointer } => {
            ("schema 'unknown member'".to_owned(), pointer, None)
        }
        IrCheckFailure::UnknownKind {
            pointer,
            tag,
            value,
        } => (
            format!("schema 'unknown {tag}'"),
            pointer,
            Some(quote_text(value)),
        ),
        IrCheckFailure::UnknownValue { pointer, value } => (
            "schema 'unknown value'".to_owned(),
            pointer,
            Some(quote_text(value)),
        ),
    }
}

fn describe_failure(candidate: &JsonValue, failure: &IrCheckFailure) -> String {
    let (rule, pointer, detail) = parts_of(failure);
    let location = match operation_id_at(candidate, pointer) {
        Some(id) => format!("'{pointer}' (operation {})", quote_text(&id)),
        None => format!("'{pointer}'"),
    };

    match detail {
        Some(detail) => format!("{rule} at {location}: {detail}"),
        None => format!("{rule} at {location}"),
    }
}

fn invalid(
    api: &str,
    what: &str,
    candidate: &JsonValue,
    failures: &[IrCheckFailure],
) -> InternalError {
    let listed: Vec<String> = failures
        .iter()
        .take(LISTED_FAILURE_LIMIT)
        .map(|failure| describe_failure(candidate, failure))
        .collect();
    let more = failures.len() - listed.len();
    let tail = if more > 0 {
        format!("; and {more} more")
    } else {
        String::new()
    };

    InternalError::new(format!(
        "finalize built an invalid {what} for api '{api}', so a pass wrote a member it should not have: {}{tail}.",
        listed.join("; ")
    ))
}

// The invariants of ADR 0004 section 13 are checked here once `checkIrInvariants` is ported into
// `seampact-ir`; until then the schema check above is the whole output check.
#[expect(
    clippy::unnecessary_wraps,
    reason = "the invariant check that replaces this body can fail"
)]
fn assert_ir_invariants(_api: &str, _candidate: &JsonValue) -> Result<(), InternalError> {
    Ok(())
}

/// Checks the built IR; an internal error naming every failure otherwise.
///
/// # Errors
///
/// An [`InternalError`] listing the failures (at most ten), or when the schemas do not build.
pub fn finalize_assert_ir(api: &str, candidate: &JsonValue) -> Result<(), InternalError> {
    let failures =
        check_strict_ir(candidate).map_err(|error| InternalError::new(error.to_string()))?;

    if !failures.is_empty() {
        return Err(invalid(api, "IR", candidate, &failures));
    }

    assert_ir_invariants(api, candidate)
}

/// Checks the built side table against its schema; an internal error naming every failure otherwise.
///
/// # Errors
///
/// An [`InternalError`] listing the failures (at most ten), or when the schemas do not build.
pub fn finalize_assert_source_map(api: &str, source_map: &SourceMap) -> Result<(), InternalError> {
    let candidate = source_map
        .to_json_value()
        .map_err(|error| InternalError::new(error.to_string()))?;
    let failures =
        check_source_map(&candidate).map_err(|error| InternalError::new(error.to_string()))?;

    if failures.is_empty() {
        return Ok(());
    }

    Err(invalid(api, "side table", &candidate, &failures))
}
