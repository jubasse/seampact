//! The `natures` catalogue (ADR 0002 section 11, A40): each contract or pack nature mapped onto
//! one of the three base natures every client's retry rule reads. A nature named like a base is
//! refused with the allowed values; the authoring schema refuses a mapping onto anything but a
//! base.

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{NatureBase, NatureDecl, NatureId};
use seampact_pipeline::pointer_below;

use crate::read::{
    derive_errors_docs, derive_errors_entries, derive_errors_origin_of, derive_errors_string,
};
use crate::report::{
    DeriveErrorsContext, DeriveErrorsProblem, DeriveErrorsReporter, DeriveErrorsRule,
};

/// The base natures written as messages list them, in the order of ADR 0002 section 11.
const ALLOWED_BASES: &str = "refused, unavailable, failed";

/// The base nature a text names, `None` for any other text.
pub(crate) fn derive_errors_is_base_nature(text: &str) -> Option<NatureBase> {
    NatureBase::known(text)
}

/// The declared natures, each mapped onto its base; a refused one is reported and left out.
///
/// # Errors
///
/// An internal error when a nature maps onto no base, which the authoring schema refuses, or when
/// a pointer has no origin.
pub(crate) fn derive_errors_natures(
    context: DeriveErrorsContext<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<IndexMap<NatureId, NatureDecl>, InternalError> {
    let mut natures = IndexMap::new();

    for (id, declaration) in derive_errors_entries(context.raw.merged.get("natures")) {
        let pointer = pointer_below("/natures", &[id]);
        let base = derive_errors_string(declaration, "base");

        if derive_errors_is_base_nature(id).is_some() {
            reporter.error(DeriveErrorsProblem {
                rule: DeriveErrorsRule::NatureBase,
                message: format!(
                    "nature {} is named like a base nature; the base natures are {ALLOWED_BASES}",
                    quote_text(id)
                ),
                fix: format!(
                    "rename the nature, or use the base nature {} directly on the error",
                    quote_text(id)
                ),
                pointer,
                related: Vec::new(),
            })?;

            continue;
        }

        // The authoring schema admits only a base here, and the validate stage runs first.
        let Some(base) = base.and_then(derive_errors_is_base_nature) else {
            return Err(InternalError::new(format!(
                "nature '{id}' maps onto '{}', which the authoring schema refuses",
                base.unwrap_or("")
            )));
        };

        natures.insert(
            NatureId::new(id.to_owned()),
            NatureDecl {
                id: NatureId::new(id.to_owned()),
                base,
                docs: derive_errors_docs(declaration),
                origin: derive_errors_origin_of(context, &pointer)?,
            },
        );
    }

    Ok(natures)
}
