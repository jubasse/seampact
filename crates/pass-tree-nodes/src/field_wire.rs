//! The wire of a field: how a form, multipart or query field is written, read from the schema service.

use seampact_diagnostics::InternalError;
use seampact_ir::{FieldWire, FieldWireKind, TypeUse};
use seampact_pipeline::{PassError, TreeSchemaService};

/// Whether a use is a file, or a list of files (a multipart field with several files).
pub(crate) fn tree_nodes_is_file_field(type_use: &TypeUse) -> bool {
    match type_use {
        TypeUse::File(_) => true,
        TypeUse::Array(array) => matches!(*array.items, TypeUse::File(_)),
        _ => false,
    }
}

/// The wire of a field without asking the schema service: a file or a JSON text field; absent otherwise.
fn plain_wire(type_use: &TypeUse) -> Option<FieldWire> {
    let kind = match type_use {
        _ if tree_nodes_is_file_field(type_use) => FieldWireKind::File,
        TypeUse::Scalar(scalar) if scalar.content.is_some() => FieldWireKind::Json,
        _ => return None,
    };

    Some(FieldWire {
        kind,
        style: None,
        explode: None,
        brackets: None,
    })
}

/// The wire of a field, or absent when the schema service has no query wire for it (an opaque value, a
/// union): the pass reports that field instead of writing it.
pub(crate) fn tree_nodes_field_wire_of(
    schema_pointer: &str,
    type_use: &TypeUse,
    tree_schemas: &dyn TreeSchemaService,
) -> Result<Option<FieldWire>, PassError> {
    if let Some(plain) = plain_wire(type_use) {
        return Ok(Some(plain));
    }

    let Some(wire) = tree_schemas.query_wire(schema_pointer)? else {
        return Ok(None);
    };
    let kind = FieldWireKind::known(wire.kind.as_str()).ok_or_else(|| {
        InternalError::new(format!(
            "the schema service answers the query wire kind {} at {schema_pointer}, which no field wire has",
            wire.kind
        ))
    })?;

    Ok(Some(FieldWire {
        kind,
        style: Some(wire.style),
        explode: Some(wire.explode),
        brackets: Some(wire.brackets),
    }))
}

/// The wire of the field at `schema_pointer`, from the schema service or the plain wire of its type.
///
/// # Errors
///
/// An internal error when the service answers no query wire for a field that needs one: `tree.schemas`
/// answers every form field and rule proof schema it accepted, and the later halves run only when it
/// reported no error. A [`PassError`] from the service.
pub fn tree_nodes_field_wire(
    schema_pointer: &str,
    type_use: &TypeUse,
    tree_schemas: &dyn TreeSchemaService,
) -> Result<FieldWire, PassError> {
    let Some(wire) = tree_nodes_field_wire_of(schema_pointer, type_use, tree_schemas)? else {
        return Err(InternalError::new(format!(
            "the schema service answers no query wire for the field at {schema_pointer}; tree.schemas answers one for every form field and rule proof schema it accepts"
        ))
        .into());
    };

    Ok(wire)
}
