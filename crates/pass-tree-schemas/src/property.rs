//! A property the compiler writes itself (a core schema's field, a derived input's field): required
//! or optional, never nullable, sensitive or deprecated, with no docs or extensions.

use seampact_ir::{DerivedFrom, Origin, Property, TypeUse};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;

/// The members a compiler-written property sets itself.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasWrittenProperty {
    pub(crate) name: String,
    pub(crate) type_use: TypeUse,
    pub(crate) optional: bool,
    pub(crate) origin: Origin,
    pub(crate) derived_from: Option<DerivedFrom>,
}

pub(crate) fn tree_schemas_derived_property(
    written: TreeSchemasWrittenProperty,
) -> Result<Property, PassError> {
    Err(not_ported_yet("treeSchemasDerivedProperty"))
}
