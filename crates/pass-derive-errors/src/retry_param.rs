//! The retry header writes the `conventions.rateLimit.param` value as a non-negative safe integer
//! (IR invariant `ir.error.retry-header`), so the code's param must provably be one: a required,
//! non-nullable integer with a minimum of at least 0 and a maximum of at most the largest safe
//! integer. A code whose param is not is refused once, located at that param, and its operations
//! write no retry header.

use std::collections::HashMap;

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{KnownTypeUseRef, ScalarType};
use seampact_json::{JsonValue, MAX_SAFE_INTEGER};
use seampact_pipeline::pointer_below;

use crate::bindings::DeriveErrorsBindingCheck;
use crate::read::derive_errors_member;
use crate::report::{
    DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter, DeriveErrorsRule,
};
use crate::role_param_fit::{derive_errors_object_of_use, derive_errors_ref_use};

/// `MAX_SAFE_INTEGER` as the `f64` a JavaScript `Number` comparison reads.
const SAFE_MAXIMUM_NUMBER: f64 = 9_007_199_254_740_991.0;

const RATE_LIMIT_PARAM_POINTER: &str = "/conventions/rateLimit/param";

/// Why the param cannot render as a non-negative safe integer, or `None` when it can.
fn retry_param_problem(
    check: &DeriveErrorsBindingCheck<'_>,
    code: &str,
    param: &str,
) -> Result<Option<String>, InternalError> {
    let params_schema = check
        .registry
        .get(code)
        .and_then(|registered| registered.declaration.params.as_ref());
    let object = match params_schema {
        None => None,
        Some(schema) => derive_errors_object_of_use(
            check.schemas,
            &KnownTypeUseRef::try_from(&derive_errors_ref_use(schema))?,
        )?,
    };
    let property = object.and_then(|object| {
        object
            .properties
            .iter()
            .find(|candidate| candidate.name == param)
    });
    let Some(property) = property.filter(|property| !property.optional && !property.nullable)
    else {
        return Ok(Some(
            "a required, non-nullable property of the code's params".to_owned(),
        ));
    };

    let integer = match KnownTypeUseRef::try_from(&property.r#type)? {
        KnownTypeUseRef::Scalar(scalar)
            if scalar.r#type == ScalarType::Integer && scalar.format.is_none() =>
        {
            scalar
        }
        _ => return Ok(Some("an integer".to_owned())),
    };

    if !bound_holds(
        integer.refinements.minimum.as_ref().map(AsRef::as_ref),
        |minimum| minimum >= 0.0,
    ) {
        return Ok(Some("an integer with a minimum of at least 0".to_owned()));
    }

    if !bound_holds(
        integer.refinements.maximum.as_ref().map(AsRef::as_ref),
        |maximum| maximum <= SAFE_MAXIMUM_NUMBER,
    ) {
        return Ok(Some(format!(
            "an integer with a maximum of at most {MAX_SAFE_INTEGER}"
        )));
    }

    Ok(None)
}

// A bound is the JavaScript `Number` of its decimal literal, NaN when it does not read as one,
// which no comparison holds.
fn bound_holds(bound: Option<&str>, holds: fn(f64) -> bool) -> bool {
    bound.is_some_and(|text| holds(number_of_decimal_text(text)))
}

// `Number(text)` for the text of a decimal literal: `Number("")` is 0, and Rust's parser would
// also read `inf` and `nan`, which JavaScript does not.
fn number_of_decimal_text(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }

    let is_decimal_character =
        |character: char| character.is_ascii_digit() || "+-.eE".contains(character);

    if !text.chars().all(is_decimal_character) {
        return f64::NAN;
    }

    text.parse::<f64>().unwrap_or(f64::NAN)
}

// The param's own pointer when the declaration writes its params inline, else the declaration,
// else the convention.
fn retry_param_pointer(check: &DeriveErrorsBindingCheck<'_>, code: &str, param: &str) -> String {
    let Some(pointer) = check
        .registry
        .get(code)
        .and_then(|registered| registered.pointer.as_deref())
    else {
        return RATE_LIMIT_PARAM_POINTER.to_owned();
    };

    if inline_param_written(check, code, param) {
        pointer_below(pointer, &["params", param])
    } else {
        pointer.to_owned()
    }
}

// Whether the merged declaration of the code writes its params inline, with this one among them.
fn inline_param_written(check: &DeriveErrorsBindingCheck<'_>, code: &str, param: &str) -> bool {
    let Some(JsonValue::Object(errors)) = check.context.raw.merged.get("errors") else {
        return false;
    };
    let Some(JsonValue::Object(declared)) = derive_errors_member(errors, code) else {
        return false;
    };
    let Some(JsonValue::Object(params)) = derive_errors_member(declared, "params") else {
        return false;
    };

    derive_errors_member(params, param).is_some()
}

/// Whether the code's param can carry the retry header; reports a refusal once per code.
///
/// # Errors
///
/// An internal error when the code's params cannot be read or a pointer has no origin.
pub(crate) fn derive_errors_check_retry_param(
    check: &DeriveErrorsBindingCheck<'_>,
    refused: &mut HashMap<String, bool>,
    code: &str,
    param: &str,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, InternalError> {
    if let Some(known) = refused.get(code) {
        return Ok(!known);
    }

    let problem = retry_param_problem(check, code, param)?;

    refused.insert(code.to_owned(), problem.is_some());

    let Some(problem) = problem else {
        return Ok(true);
    };
    let quoted_param = quote_text(param);
    let quoted_code = quote_text(code);

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::RetryParam,
        message: format!(
            "conventions.rateLimit.param {quoted_param} is not {problem} of {quoted_code}, which carries the retry header"
        ),
        fix: format!(
            "declare {quoted_param} in {quoted_code} as a required integer with minimum 0 and maximum {MAX_SAFE_INTEGER}"
        ),
        pointer: retry_param_pointer(check, code, param),
        related: vec![DeriveErrorsRelated {
            pointer: RATE_LIMIT_PARAM_POINTER.to_owned(),
            message: "the param is named here".to_owned(),
        }],
    })?;

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimum_holds(text: Option<&str>) -> bool {
        bound_holds(text, |minimum| minimum >= 0.0)
    }

    fn maximum_holds(text: Option<&str>) -> bool {
        bound_holds(text, |maximum| maximum <= SAFE_MAXIMUM_NUMBER)
    }

    #[test]
    fn a_minimum_is_read_as_a_javascript_number() {
        // `Number("-0") >= 0` and `Number("") >= 0` hold; an absent or unreadable bound holds nothing.
        for (text, expected) in [
            (Some("0"), true),
            (Some("-0"), true),
            (Some("0.5"), true),
            (Some("-1"), false),
            (Some("-0.000000000000000001"), false),
            (Some(""), true),
            (Some("inf"), false),
            (Some("NaN"), false),
            (None, false),
        ] {
            assert_eq!(minimum_holds(text), expected, "minimum {text:?}");
        }
    }

    #[test]
    fn a_maximum_is_compared_as_a_double() {
        // 2^53 + 1 reads as 2^53, past the largest safe integer, as it does in JavaScript.
        for (text, expected) in [
            (Some("9007199254740991"), true),
            (Some("9007199254740992"), false),
            (Some("9007199254740993"), false),
            (Some("1e999"), false),
            (Some("-1"), true),
            (None, false),
        ] {
            assert_eq!(maximum_holds(text), expected, "maximum {text:?}");
        }
    }
}
