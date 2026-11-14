//! The wire of a field: how a form, multipart or query field is written, read from the schema service.

use seampact_ir::{FieldWire, TypeUse};
use seampact_pipeline::{PassError, TreeSchemaService};

use crate::not_ported::not_ported_yet;

pub(crate) fn tree_nodes_is_file_field(_type_use: &TypeUse) -> Result<bool, PassError> {
    Err(not_ported_yet("treeNodesIsFileField"))
}

fn plain_wire(_type_use: &TypeUse) -> Result<Option<FieldWire>, PassError> {
    Err(not_ported_yet("plainWire"))
}

pub(crate) fn tree_nodes_field_wire_of(
    _schema_pointer: &str,
    _type_use: &TypeUse,
    _tree_schemas: &dyn TreeSchemaService,
) -> Result<Option<FieldWire>, PassError> {
    Err(not_ported_yet("treeNodesFieldWireOf"))
}

/// The wire of the field at `schema_pointer`, from the schema service or the plain wire of its type.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub fn tree_nodes_field_wire(
    _schema_pointer: &str,
    _type_use: &TypeUse,
    _tree_schemas: &dyn TreeSchemaService,
) -> Result<FieldWire, PassError> {
    Err(not_ported_yet("treeNodesFieldWire"))
}
