//! What a body slot holds: the shape an operation answers, the resource, the url schema.

use seampact_ir::{
    Absent, KnownSchemaRef, NamedTemplate, Operation, ResponseShape, Shape, SuccessShapes, TypeUse,
    UrlForm, WireFormat,
};
use seampact_json::JsonObject;
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::EmitContext;
use crate::json_value::{integer_value, text_value};
use crate::not_ported::not_ported_yet;
use crate::responses::PayloadShape;
use crate::templates::{SlotSchemas, SlotValue};

/// The slot of a body template that holds the payload.
pub(crate) const PAYLOAD_SLOT: &str = "payload";

/// The slot that holds the resource type of the operation.
const COLLECTION_SLOT: &str = "collection";

/// The slot that holds the resource an item type names.
const RESOURCE_SLOT: &str = "resource";

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

impl EmittedShape {
    /// The shape of a response, or `None` for a shape the emitter does not write as a body.
    pub(crate) fn of(shape: &ResponseShape) -> Option<Self> {
        match shape {
            ResponseShape::Item => Some(Self::Item),
            ResponseShape::Table => Some(Self::Table),
            ResponseShape::List => Some(Self::List),
            ResponseShape::Page => Some(Self::Page),
            ResponseShape::Empty
            | ResponseShape::Binary
            | ResponseShape::Redirect
            | ResponseShape::Unknown(_) => None,
        }
    }

    /// The shape as the IR writes it.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Item => "item",
            Self::Table => "table",
            Self::List => "list",
            Self::Page => "page",
        }
    }

    /// The shape of a payload wrapper, or `None` for a page, which has its own body.
    pub(crate) const fn payload_shape(self) -> Option<PayloadShape> {
        match self {
            Self::Item => Some(PayloadShape::Item),
            Self::Table => Some(PayloadShape::Table),
            Self::List => Some(PayloadShape::List),
            Self::Page => None,
        }
    }

    /// The success shape of a format that writes this response shape.
    pub(crate) const fn success_of(self, success: &SuccessShapes) -> &Shape {
        match self {
            Self::Item => &success.item,
            Self::Table => &success.table,
            Self::List => &success.list,
            Self::Page => &success.page,
        }
    }
}

/// The schema of a url: a `uri` when the api writes absolute urls, else a `uri-reference`.
pub(crate) fn url_schema(context: &EmitContext<'_>) -> JsonObject {
    let format = if context.ir.api.wire.urls == UrlForm::Absolute {
        "uri"
    } else {
        "uri-reference"
    };
    JsonObject::from_iter([
        ("type".to_owned(), text_value("string")),
        ("format".to_owned(), text_value(format)),
    ])
}

/// The resource an item type names: its object schema's type name, else the schema id.
pub(crate) fn resource_name<'borrow>(
    context: &'borrow EmitContext<'_>,
    item: &'borrow TypeUse,
) -> Option<&'borrow str> {
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

/// The slots every success body template reads: status, path, self url, and the resource slots.
pub(crate) fn success_slots(
    context: &EmitContext<'_>,
    operation: &Operation,
    status: i64,
    item: &TypeUse,
) -> SlotSchemas {
    let status_schema = JsonObject::from_iter([
        ("type".to_owned(), text_value("integer")),
        ("const".to_owned(), integer_value(status)),
    ]);
    let string_schema = JsonObject::from_iter([("type".to_owned(), text_value("string"))]);
    let mut slots = SlotSchemas::from_iter([
        ("status".to_owned(), SlotValue::always(status_schema)),
        ("path".to_owned(), SlotValue::always(string_schema)),
        ("self".to_owned(), SlotValue::always(url_schema(context))),
    ]);

    // A route of no resource has no value for `$collection`.
    if let Some(resource) = &operation.resource {
        slots.insert(COLLECTION_SLOT.to_owned(), constant_slot(&resource.r#type));
    }

    if let Some(resource) = resource_name(context, item) {
        slots.insert(RESOURCE_SLOT.to_owned(), constant_slot(resource));
    }

    slots
}

/// A slot that always holds the text `value`.
pub(crate) fn constant_slot(value: &str) -> SlotValue {
    SlotValue::always(JsonObject::from_iter([(
        "const".to_owned(),
        text_value(value),
    )]))
}

pub(crate) fn add_meta_slot(
    _context: &mut EmitContext<'_>,
    _slots: &mut SlotSchemas,
    _format: &WireFormat,
    _style_meta: &[NamedTemplate],
    _style_absent: &Absent,
    _role_slots: &SlotSchemas,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("addMetaSlot"))
}
