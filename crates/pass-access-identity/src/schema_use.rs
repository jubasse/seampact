//! The type use of a schema written in the raw tree, as the schema service answers it.

use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, TypeUse};
use seampact_pipeline::{PassError, TreeSchemaService};

/// The type use of the schema written at `pointer`.
///
/// `tree.schemas` compiles every written schema, so a service that answers none is an internal
/// error: leaving the element out would drop an identity, weakening deny by default.
///
/// # Errors
///
/// An internal error when the service answers no use, and what the service fails with.
pub(crate) fn access_identity_schema_use(
    schemas: &dyn TreeSchemaService,
    pointer: &str,
    direction: &Direction,
) -> Result<TypeUse, PassError> {
    let answer = schemas.type_use(pointer, direction.clone())?;

    answer.ok_or_else(|| {
        InternalError::new(format!(
            "the schema service answers no {direction} type use for the schema written at {pointer}"
        ))
        .into()
    })
}
