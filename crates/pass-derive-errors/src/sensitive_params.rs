//! An error code whose params carry a sensitive value (ADR 0003 section 6): a property marked
//! sensitive, or a scalar use marked sensitive, at any depth of the params schema. Every response
//! of the code is no-store under `conventions.cache.sensitiveElsewhere: noStore`, the default
//! (`ErrorDecl.noStore`), and the declaration is a compile error under `refuse`, located at its
//! params.

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    ErrorCode, IrMap, IrSensitiveReach, Schema, SchemaId, SchemaRef,
    find_ir_sensitive_param_reaches, sensitive_reach_text,
};
use seampact_json::JsonValue;
use seampact_pipeline::{ConventionReading, SENSITIVE_ELSEWHERE_REFUSE};

use crate::report::{
    DeriveErrorsContext, DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter,
    DeriveErrorsRule,
};

/// What the check reads: the conventions and the schemas tree.schemas wrote.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsSensitiveSources<'sources> {
    pub(crate) context: DeriveErrorsContext<'sources>,
    pub(crate) schemas: &'sources IrMap<SchemaId, Schema>,
}

/// An error code's params, and the pointer a refusal is located at.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeriveErrorsSensitiveSite<'site> {
    pub(crate) code: &'site ErrorCode,
    pub(crate) params: &'site SchemaRef,
    pub(crate) pointer: &'site str,
}

/// Whether the params of the code make it no-store; under `refuse`, a sensitive value is reported
/// and it is not.
///
/// # Errors
///
/// An internal error when the params reference a schema tree.schemas did not write.
pub(crate) fn derive_errors_params_no_store(
    site: &DeriveErrorsSensitiveSite<'_>,
    sources: &DeriveErrorsSensitiveSources<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, InternalError> {
    let reaches =
        find_ir_sensitive_param_reaches(site.params, sources.schemas).map_err(|error| {
            InternalError::new(format!(
                "the params of {} reference schema '{}', which tree.schemas did not write",
                quote_text(site.code.as_str()),
                error.schema
            ))
        })?;
    let Some(found) = reaches.first() else {
        return Ok(false);
    };
    let policy = sources
        .context
        .conventions
        .get("cache.sensitiveElsewhere")?;
    let refusing = policy.filter(
        |reading| matches!(reading.value, JsonValue::String(text) if text == SENSITIVE_ELSEWHERE_REFUSE),
    );
    let Some(policy) = refusing else {
        return Ok(true);
    };

    report_refused(site, found, &policy, reporter)?;

    Ok(false)
}

fn report_refused(
    site: &DeriveErrorsSensitiveSite<'_>,
    found: &IrSensitiveReach,
    policy: &ConventionReading<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let related = policy
        .origin
        .iter()
        .map(|origin| DeriveErrorsRelated {
            pointer: origin.pointer.clone(),
            message: "the convention".to_owned(),
        })
        .collect();

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::CacheSensitiveElsewhere,
        message: format!(
            "conventions.cache.sensitiveElsewhere is refuse, so the params of error {} may not carry {}",
            quote_text(site.code.as_str()),
            sensitive_reach_text(found)
        ),
        fix: "Drop the sensitive mark from the params, or set conventions.cache.sensitiveElsewhere: noStore."
            .to_owned(),
        pointer: site.pointer.to_owned(),
        related,
    })
}
