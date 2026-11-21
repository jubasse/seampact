//! What a body slot holds: the shape an operation answers, the resource, the url schema.

use seampact_ir::{KnownSchemaRef, TypeUse, UrlForm};
use seampact_json::{JsonObject, JsonValue};

use crate::emit_context::EmitContext;
use crate::json_value::text_value;

/// The response shapes a body is written as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EmittedShape {
    /// One item.
    Item,
    /// A table.
    Table,
    /// A list.
    List,
    /// A page.
    Page,
}

/// The shape named `shape`, or `None` for a shape the emitter does not write as a body.
pub(crate) fn emitted_shape_of(shape: &str) -> Option<EmittedShape> {
    match shape {
        "item" => Some(EmittedShape::Item),
        "table" => Some(EmittedShape::Table),
        "list" => Some(EmittedShape::List),
        "page" => Some(EmittedShape::Page),
        _ => None,
    }
}

/// The schema of a url: a `uri` when the api writes absolute urls, else a `uri-reference`.
pub(crate) fn url_schema(context: &EmitContext<'_>) -> JsonObject {
    let format = if context.ir.api.wire.urls == UrlForm::Absolute {
        "uri"
    } else {
        "uri-reference"
    };
    let mut schema = JsonObject::new();

    schema.insert("type".to_owned(), text_value("string"));
    schema.insert("format".to_owned(), JsonValue::String(format.to_owned()));

    schema
}

/// The resource an item type names: its object schema's type name, else the schema id.
pub(crate) fn resource_name<'ir>(
    context: &EmitContext<'ir>,
    item: &'ir TypeUse,
) -> Option<&'ir str> {
    let TypeUse::Ref(reference) = item else {
        return None;
    };
    let named = context.ir.schemas.get(reference.schema.as_str())?;

    match KnownSchemaRef::try_from(named) {
        Ok(KnownSchemaRef::Object(object)) => Some(
            object
                .type_name
                .as_deref()
                .unwrap_or_else(|| reference.schema.as_str()),
        ),
        Ok(KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_)) | Err(_) => None,
    }
}
