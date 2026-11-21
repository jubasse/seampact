//! The request and response bodies of an operation.

use seampact_ir::{Operation, OperationInput, TypeUse, UnknownKeys};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::emit_context::{EmitContext, refuse_not_emitted, write_extension};
use crate::not_ported::not_ported_yet;
use crate::{ExtensionName, OpenApiError};

/// The media type of the JSON bodies an input declares.
const JSON_MEDIA: &str = "application/json";

/// The media type an input is written with: the format's own when the input says plain JSON.
fn body_media<'borrow>(
    context: &'borrow EmitContext<'_>,
    operation: &Operation,
    input: &'borrow OperationInput,
) -> &'borrow str {
    if input.media.as_str() != JSON_MEDIA {
        return input.media.as_str();
    }

    context
        .ir
        .formats
        .get(operation.format.as_str())
        .map_or(input.media.as_str(), |format| format.media.as_str())
}

/// The request body of an operation, or `None` for an operation without input.
///
/// # Errors
///
/// As the writers of the body schema and its encoding.
pub(crate) fn request_body(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    examples: Option<&JsonObject>,
    location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    let Some(input) = &operation.input else {
        if examples.is_some() {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleRequest,
                "A request example on an operation without input",
                location,
            );
        }

        return Ok(None);
    };
    let input_location = location.below(&["input"]);
    let schema = body_schema(context, input, &input_location)?;
    let mut media_object =
        JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);
    let encoding = body_encoding(context, input, &input_location)?;

    if !encoding.is_empty() {
        media_object.insert("encoding".to_owned(), JsonValue::Object(encoding));
    }

    if let Some(written) = examples {
        media_object.insert("examples".to_owned(), JsonValue::Object(written.clone()));
    }

    let media_by_type = JsonObject::from_iter([(
        body_media(context, operation, input).to_owned(),
        JsonValue::Object(media_object),
    )]);
    let mut body = JsonObject::from_iter([
        ("required".to_owned(), JsonValue::Bool(true)),
        ("content".to_owned(), JsonValue::Object(media_by_type)),
    ]);

    if let TypeUse::Ref(reference) = &input.schema
        && let Some(unknown_keys) = &reference.unknown_keys
    {
        write_unknown_keys(
            context,
            &mut body,
            unknown_keys,
            &input_location.below(&["schema"]),
        )?;
    }

    if input.raw_body {
        write_extension(
            context,
            &mut body,
            ExtensionName::RawBody,
            JsonValue::Bool(true),
        );
    }

    Ok(Some(body))
}

fn body_schema(
    _context: &mut EmitContext<'_>,
    _input: &OperationInput,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("bodySchema"))
}

fn body_encoding(
    _context: &mut EmitContext<'_>,
    _input: &OperationInput,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("bodyEncoding"))
}

fn write_unknown_keys(
    _context: &mut EmitContext<'_>,
    _body: &mut JsonObject,
    _unknown_keys: &UnknownKeys,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("writeUnknownKeys"))
}
