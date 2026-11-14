//! The retry header writes the `conventions.rateLimit.param` value as a non-negative safe integer
//! (IR invariant `ir.error.retry-header`), so the code's param must provably be one: a required,
//! non-nullable integer with a minimum of at least 0 and a maximum of at most the largest safe
//! integer. A code whose param is not is refused once, located at that param, and its operations
//! write no retry header.

use std::collections::HashMap;

use seampact_pipeline::PassError;

use crate::bindings::DeriveErrorsBindingCheck;
use crate::not_ported::not_ported_yet;
use crate::report::DeriveErrorsReporter;

/// The largest integer a JSON number holds exactly.
const SAFE_MAXIMUM: i64 = 9_007_199_254_740_991;

const RATE_LIMIT_PARAM_POINTER: &str = "/conventions/rateLimit/param";

/// Why the param cannot render as a non-negative safe integer, or `None` when it can.
fn retry_param_problem(
    _check: &DeriveErrorsBindingCheck<'_>,
    _code: &str,
    _param: &str,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("retryParamProblem"))
}

// The param's own pointer when the declaration writes its params inline, else the declaration,
// else the convention.
fn retry_param_pointer(
    _check: &DeriveErrorsBindingCheck<'_>,
    _code: &str,
    _param: &str,
) -> Result<String, PassError> {
    Err(not_ported_yet("retryParamPointer"))
}

/// Whether the code's param can carry the retry header; reports a refusal once per code.
///
/// # Errors
///
/// A [`PassError`] when the param cannot be checked yet.
pub(crate) fn derive_errors_check_retry_param(
    _check: &DeriveErrorsBindingCheck<'_>,
    _refused: &mut HashMap<String, bool>,
    _code: &str,
    _param: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsCheckRetryParam"))
}
