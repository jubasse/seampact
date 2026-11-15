//! The context every function of the half reads, and the schema service's type uses.

use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, KnownTypeUseRef, SchemaRef, TypeUse};
use seampact_pipeline::AccessRightsOutput;
use seampact_pipeline::{DraftIr, HalfContext, PassError, TreeNodes, TreeSchemaService};

/// What one run of the half reads and writes: the draft, the half context, the schema service,
/// the tree nodes of the raw tree and the owned output.
pub(crate) struct AccessRightsContext<'draft, 'half, 'run> {
    pub(crate) draft: &'draft DraftIr,
    pub(crate) context: &'half mut HalfContext<'run>,
    pub(crate) schemas: &'half dyn TreeSchemaService,
    pub(crate) nodes: TreeNodes<'run>,
    pub(crate) output: AccessRightsOutput,
}

/// The type use of the schema written at `pointer`.
///
/// # Errors
///
/// An internal error when the service answers none: `tree.schemas` compiled every written schema,
/// so dropping a right, a scope or a subject would weaken a check silently.
pub(crate) fn access_rights_type_use(
    context: &AccessRightsContext,
    pointer: &str,
    direction: &Direction,
) -> Result<TypeUse, PassError> {
    let answered = context.schemas.type_use(pointer, direction.clone())?;

    answered.ok_or_else(|| {
        InternalError::new(format!(
            "the schema service answers no {direction} type use for the schema written at {pointer}"
        ))
        .into()
    })
}

/// The params schema of a right or rule: `tree.schemas` names it (a fields map is hoisted as
/// `<Owner>Params`).
///
/// # Errors
///
/// An internal error when the use is not a reference.
pub(crate) fn access_rights_params_ref(
    context: &AccessRightsContext,
    pointer: &str,
) -> Result<SchemaRef, PassError> {
    let type_use = access_rights_type_use(context, pointer, &Direction::Input)?;
    let kind = match KnownTypeUseRef::try_from(&type_use)? {
        KnownTypeUseRef::Ref(reference) => return Ok(reference.schema.clone()),
        KnownTypeUseRef::Array(_) => "array",
        KnownTypeUseRef::Scalar(_) => "scalar",
        KnownTypeUseRef::Enum(_) => "enum",
        KnownTypeUseRef::File(_) => "file",
        KnownTypeUseRef::Opaque(_) => "opaque",
    };

    Err(InternalError::new(format!(
        "the schema service answers a {kind} use for the params at {pointer}; params are a named object schema"
    ))
    .into())
}
