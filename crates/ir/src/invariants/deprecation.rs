//! The rules of a deprecated operation: its headers, its successor and its dates.

use std::cmp::Ordering;

use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, object_of, text_of};

use super::decode::decode_member;
use super::violation::{IrInvariantId, Violations};
use crate::{IrError, TypeUse, is_ir_calendar_date, is_ir_same_type_use};

/// The header semantics a deprecated operation's success responses carry.
const DEPRECATION_SEMANTICS: [&str; 3] = ["deprecation", "sunset", "successorLink"];

/// The status range of a success response.
const SUCCESS_STATUSES: std::ops::RangeInclusive<f64> = 200.0..=299.0;

fn is_success(response: &JsonValue) -> bool {
    match object_of(Some(response)).and_then(|response| response.get("status")) {
        Some(JsonValue::Number(status)) => SUCCESS_STATUSES.contains(&status.to_f64()),
        _ => false,
    }
}

fn header_count(response: &JsonValue, semantic: &str) -> usize {
    let headers = items_of(object_of(Some(response)).and_then(|response| response.get("headers")));

    headers
        .iter()
        .filter(|header| {
            is_text(
                object_of(Some(header)).and_then(|header| header.get("semantic")),
                semantic,
            )
        })
        .count()
}

/// The deprecation rules that read an operation as a whole: `successorRel` against `successor`,
/// the headers of each response, and the successor named in the same api.
///
/// # Errors
///
/// [`IrError::Decode`] when two path param types to compare do not decode.
pub(super) fn check_deprecation_headers(
    operation: &JsonObject,
    pointer: &str,
    operations: &[JsonValue],
    api_id: Option<&JsonValue>,
    out: &mut Violations,
) -> Result<(), IrError> {
    let deprecated = object_of(operation.get("deprecated"));
    let successor = object_of(deprecated.and_then(|deprecated| deprecated.get("successor")));

    if let Some(deprecated) = deprecated
        && deprecated.contains_key("successorRel") != successor.is_some()
    {
        out.fail(
            IrInvariantId::DeprecationHeaders,
            &format!("{pointer}/deprecated"),
            "A deprecation has 'successorRel' if and only if it has 'successor'.".to_owned(),
        );
    }

    for (index, response) in items_of(operation.get("responses")).iter().enumerate() {
        let signals = deprecated.is_some() && is_success(response);

        for semantic in DEPRECATION_SEMANTICS {
            let count = header_count(response, semantic);
            let expected =
                usize::from(signals && !(semantic == "successorLink" && successor.is_none()));

            if count == expected {
                continue;
            }

            let message = if signals {
                let amount = if expected == 1 { "one" } else { "no" };

                format!(
                    "A 2xx response of a deprecated operation carries {amount} '{semantic}' header, not {count}."
                )
            } else {
                format!(
                    "Only a 2xx response of a deprecated operation carries a '{semantic}' header; this one carries {count}."
                )
            };

            out.fail(
                IrInvariantId::DeprecationHeaders,
                &format!("{pointer}/responses/{index}"),
                message,
            );
        }
    }

    let Some(successor) = successor else {
        return Ok(());
    };

    if successor.get("api") != api_id {
        return Ok(());
    }

    let target = operations
        .iter()
        .filter_map(|candidate| object_of(Some(candidate)))
        .find(|candidate| candidate.get("id") == successor.get("id"));
    let Some(target) = target else {
        out.fail(
            IrInvariantId::DeprecationHeaders,
            &format!("{pointer}/deprecated/successor"),
            format!(
                "The successor '{}' names no operation of this api.",
                js_text_of(successor.get("id"))
            ),
        );

        return Ok(());
    };

    check_successor_params(operation, target, pointer, out)
}

fn path_params_of(operation: &JsonObject) -> Vec<&JsonObject> {
    let params = object_of(operation.get("params"));

    items_of(params.and_then(|params| params.get("path")))
        .iter()
        .filter_map(|param| object_of(Some(param)))
        .collect()
}

// The successor link fills the successor's path params from the deprecated request's, so each is
// one of them.
fn check_successor_params(
    operation: &JsonObject,
    successor: &JsonObject,
    pointer: &str,
    out: &mut Violations,
) -> Result<(), IrError> {
    let own = path_params_of(operation);

    for param in path_params_of(successor) {
        let matching = own
            .iter()
            .find(|candidate| candidate.get("name") == param.get("name"));
        let same_type = match matching {
            Some(matching) => same_type_use(matching.get("type"), param.get("type"))?,
            None => false,
        };

        if !same_type {
            out.fail(
                IrInvariantId::DeprecationHeaders,
                &format!("{pointer}/deprecated/successor"),
                format!(
                    "The successor's path param '{}' is no path param of this operation of the same type.",
                    js_text_of(param.get("name"))
                ),
            );
        }
    }

    Ok(())
}

fn same_type_use(left: Option<&JsonValue>, right: Option<&JsonValue>) -> Result<bool, IrError> {
    let left: TypeUse = decode_member(left)?;
    let right: TypeUse = decode_member(right)?;

    is_ir_same_type_use(&left, &right)
}

/// A deprecation's `since` and `sunset` are calendar days, and `since` is not after `sunset`.
pub(super) fn check_deprecation_dates(value: &JsonObject, pointer: &str, out: &mut Violations) {
    let since = text_of(value.get("since"));
    let sunset = text_of(value.get("sunset"));

    for (member, date) in [("since", since), ("sunset", sunset)] {
        if let Some(date) = date
            && !is_ir_calendar_date(date)
        {
            out.fail(
                IrInvariantId::DeprecationSince,
                &format!("{pointer}/{member}"),
                format!("'{date}' is no calendar day."),
            );
        }
    }

    if let (Some(since), Some(sunset)) = (since, sunset)
        && cmp_utf16(since, sunset) == Ordering::Greater
    {
        out.fail(
            IrInvariantId::DeprecationSince,
            pointer,
            format!("The deprecation starts on {since}, after its sunset {sunset}."),
        );
    }
}
