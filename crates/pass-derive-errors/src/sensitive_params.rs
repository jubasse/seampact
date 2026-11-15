//! An error code whose params carry a sensitive value (ADR 0003 section 6): a property marked
//! sensitive, or a scalar use marked sensitive, at any depth of the params schema. Every response
//! of the code is no-store under `conventions.cache.sensitiveElsewhere: noStore`, the default
//! (`ErrorDecl.noStore`), and the declaration is a compile error under `refuse`, located at its
//! params.

use seampact_ir::{ErrorCode, IrMap, IrSensitiveReach, Schema, SchemaId, SchemaRef};
use seampact_pipeline::{ConventionReading, PassError};

use crate::not_ported::not_ported_yet;
use crate::report::{DeriveErrorsContext, DeriveErrorsReporter};

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
/// A [`PassError`] when the params cannot be walked yet.
pub(crate) fn derive_errors_params_no_store(
    _site: &DeriveErrorsSensitiveSite<'_>,
    _sources: &DeriveErrorsSensitiveSources<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsParamsNoStore"))
}

fn report_refused(
    _site: &DeriveErrorsSensitiveSite<'_>,
    _found: &IrSensitiveReach,
    _policy: &ConventionReading<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRefused"))
}
