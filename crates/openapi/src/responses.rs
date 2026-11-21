//! The responses of an operation.

use seampact_ir::{Operation, Response, WireFormat};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::EmitContext;
use crate::json_value::text_value;
use crate::not_ported::not_ported_yet;

/// The first status that is no success.
const SUCCESS_STATUS_LIMIT: i64 = 300;

/// The first status that is no redirection.
const REDIRECT_STATUS_LIMIT: i64 = 400;

/// The shapes whose payload is wrapped into a schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PayloadShape {
    /// One item: the payload itself.
    Item,
    /// A table: an object whose values are the payload.
    Table,
    /// A list: an array of the payload.
    List,
}

/// The description of a response: what its docs say, else a default by status.
fn response_description(response: &Response) -> &str {
    let docs = response.docs.as_ref();
    let written = docs
        .and_then(|docs| docs.description.as_deref())
        .or_else(|| docs.and_then(|docs| docs.summary.as_deref()));

    if let Some(text) = written {
        return text;
    }

    if response.status < SUCCESS_STATUS_LIMIT {
        return "Success.";
    }

    if response.status < REDIRECT_STATUS_LIMIT {
        "Redirection."
    } else {
        "Response."
    }
}

/// The schema of a response body of a shape, around the schema of its payload.
fn payload_schema_of(shape: PayloadShape, payload: JsonObject) -> JsonObject {
    match shape {
        PayloadShape::Table => JsonObject::from_iter([
            ("type".to_owned(), text_value("object")),
            (
                "additionalProperties".to_owned(),
                JsonValue::Object(payload),
            ),
        ]),
        PayloadShape::List => JsonObject::from_iter([
            ("type".to_owned(), text_value("array")),
            ("items".to_owned(), JsonValue::Object(payload)),
        ]),
        PayloadShape::Item => payload,
    }
}

/// The response object of a success status.
fn success_response(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    format: &WireFormat,
    response: &Response,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut response_object = JsonObject::from_iter([(
        "description".to_owned(),
        text_value(response_description(response)),
    )]);
    let headers = response_headers(context, operation, response, location)?;

    if !headers.is_empty() {
        response_object.insert("headers".to_owned(), JsonValue::Object(headers));
    }

    let body = response_body_schema(context, operation, format, response, location)?;

    if let (Some(schema), Some(media_type)) = (body, &response.media) {
        let media_entry = JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);
        let body_content =
            JsonObject::from_iter([(media_type.clone(), JsonValue::Object(media_entry))]);

        response_object.insert("content".to_owned(), JsonValue::Object(body_content));
    }

    Ok(response_object)
}

/// The schema of a response body, or `None` for an empty or redirect response.
fn response_body_schema(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _format: &WireFormat,
    _response: &Response,
    _location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    Err(not_ported_yet("responseBodySchema"))
}

/// The headers of a response.
fn response_headers(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _response: &Response,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("responseHeaders"))
}
