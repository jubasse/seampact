//! The context every function of the half reads, and the schema service's type uses.

use seampact_ir::{Direction, SchemaRef, TypeUse};
use seampact_pipeline::AccessRightsOutput;
use seampact_pipeline::{DraftIr, HalfContext, PassError, TreeNodes, TreeSchemaService};

use crate::not_ported::not_ported_yet;

/// What one run of the half reads and writes: the draft, the half context, the schema service,
/// the tree nodes of the raw tree and the owned output.
pub(crate) struct AccessRightsContext<'draft, 'half, 'run> {
    pub(crate) draft: &'draft DraftIr,
    pub(crate) context: &'half mut HalfContext<'run>,
    pub(crate) schemas: &'half dyn TreeSchemaService,
    pub(crate) nodes: TreeNodes<'run>,
    pub(crate) output: AccessRightsOutput,
}

pub(crate) fn access_rights_type_use(
    _context: &AccessRightsContext,
    _pointer: &str,
    _direction: &Direction,
) -> Result<TypeUse, PassError> {
    Err(not_ported_yet("accessRightsTypeUse"))
}

pub(crate) fn access_rights_params_ref(
    _context: &AccessRightsContext,
    _pointer: &str,
) -> Result<SchemaRef, PassError> {
    Err(not_ported_yet("accessRightsParamsRef"))
}
