//! The responses of an operation.

use indexmap::{IndexMap, IndexSet};
use seampact_ir::{
    Operation, Response, ResponseHeader, ResponseHeaderSemantic, ResponseShape, WireFormat,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::body_slots::{EmittedShape, PAYLOAD_SLOT, add_meta_slot, success_slots};
use crate::emit_context::{
    EmitContext, SchemaVariant, refuse_inconsistent, refuse_not_emitted, refuse_unknown,
    write_extension,
};
use crate::examples::{ExampleSet, response_examples};
use crate::json_value::text_value;
use crate::paging::page_body_schema;
use crate::schemas::type_use_schema;
use crate::templates::{SlotSchemas, SlotValue, template_schema};
use crate::{ExtensionName, OpenApiError};

/// The `Cache-Control` header.
const CACHE_CONTROL_HEADER: &str = "Cache-Control";

/// The status of a response that reuses the cached body.
const NOT_MODIFIED_STATUS: i64 = 304;

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
///
/// # Errors
///
/// As the writers of the types and templates it reaches.
fn response_body_schema(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    format: &WireFormat,
    response: &Response,
    location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    let shape_location = location.below(&["shape"]);

    let Some(shape) = (match &response.shape {
        ResponseShape::Empty | ResponseShape::Redirect => return Ok(None),
        ResponseShape::Binary => {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiResponseShape,
                &format!("A '{}' response", response.shape),
                &shape_location,
            );

            None
        }
        ResponseShape::Unknown(unknown) => {
            refuse_unknown(context, &shape_location, unknown.as_str());

            None
        }
        known => EmittedShape::of(known),
    }) else {
        return Ok(None);
    };
    let Some(body) = &response.body else {
        refuse_inconsistent(
            context,
            "response.body",
            &format!("A '{}' response has no body", shape.as_str()),
            location,
        );

        return Ok(None);
    };
    let success_shape = shape.success_of(&format.success);
    let format_location =
        IrLocation::root().below(&["formats", format.id.as_str(), "success", shape.as_str()]);

    if !success_shape.headers.is_empty() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiFormatSuccessHeaders,
            "A success header written by the format",
            &format_location.below(&["headers"]),
        );
    }

    let payload = type_use_schema(
        context,
        body,
        SchemaVariant::Shared,
        &location.below(&["body"]),
    )?;
    let Some(payload_shape) = shape.payload_shape() else {
        return page_body_schema(
            context,
            operation,
            format,
            body,
            payload,
            response.status,
            location,
        );
    };
    let mut slots = success_slots(context, operation, response.status, body);

    slots.insert(
        PAYLOAD_SLOT.to_owned(),
        SlotValue::always(payload_schema_of(payload_shape, payload)),
    );

    let body_location = format_location.below(&["body"]);

    add_meta_slot(
        context,
        &mut slots,
        format,
        &[],
        &format.absent,
        &SlotSchemas::new(),
        &body_location,
    )?;

    Ok(template_schema(
        context,
        &success_shape.body,
        &slots,
        &format.absent,
        &body_location,
    )?
    .map(|value| value.schema))
}

/// The headers of a response: its own, the cache control, and the degraded-mode header.
///
/// # Errors
///
/// As [`header_object`].
fn response_headers(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    response: &Response,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut headers = JsonObject::new();

    for (index, header) in response.headers.iter().enumerate() {
        let header_location = location.below(&["headers", &index.to_string()]);

        headers.insert(
            header.name.clone(),
            JsonValue::Object(header_object(context, operation, header, &header_location)?),
        );
    }

    let is_success =
        response.status < SUCCESS_STATUS_LIMIT || response.status == NOT_MODIFIED_STATUS;

    if let (Some(cache), true) = (&operation.cache, is_success) {
        let values: IndexSet<&str> = cache
            .per_caller_kind
            .iter()
            .map(|entry| entry.cache_control.as_str())
            .collect();
        let per_caller: JsonObject = cache
            .per_caller_kind
            .iter()
            .map(|entry| {
                (
                    entry.caller.as_str().to_owned(),
                    text_value(&entry.cache_control),
                )
            })
            .collect();
        let schema = JsonObject::from_iter([
            ("type".to_owned(), text_value("string")),
            (
                "enum".to_owned(),
                JsonValue::Array(values.into_iter().map(text_value).collect()),
            ),
        ]);
        let mut header = JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);

        write_extension(
            context,
            &mut header,
            ExtensionName::CacheControl,
            JsonValue::Object(per_caller),
        );
        headers.insert(CACHE_CONTROL_HEADER.to_owned(), JsonValue::Object(header));
    }

    let degraded_header = operation
        .degradable
        .as_ref()
        .and_then(|degradable| degradable.header.as_deref());

    if let (Some(name), true) = (degraded_header, response.status < SUCCESS_STATUS_LIMIT) {
        let schema = JsonObject::from_iter([("type".to_owned(), text_value("string"))]);
        let header = JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);

        headers.insert(name.to_owned(), JsonValue::Object(header));
    }

    Ok(headers)
}

/// The header object of a response header: its description, schema and semantic.
///
/// # Errors
///
/// As the writer of the type use schema.
fn header_object(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    header: &ResponseHeader,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut object = JsonObject::new();
    let successor_rel = operation
        .deprecated
        .as_ref()
        .and_then(|deprecated| deprecated.successor_rel.as_deref());

    if header.semantic == Some(ResponseHeaderSemantic::SuccessorLink)
        && let Some(rel) = successor_rel
    {
        object.insert(
            "description".to_owned(),
            JsonValue::text(&format!("The successor operation, with rel \"{rel}\".")),
        );
    }

    if header.required {
        object.insert("required".to_owned(), JsonValue::Bool(true));
    }

    let schema = type_use_schema(
        context,
        &header.r#type,
        SchemaVariant::Shared,
        &location.below(&["type"]),
    )?;

    object.insert("schema".to_owned(), JsonValue::Object(schema));

    if let Some(semantic) = &header.semantic {
        write_extension(
            context,
            &mut object,
            ExtensionName::Semantic,
            JsonValue::text(semantic.as_str()),
        );
    }

    Ok(object)
}

/// The success responses of an operation by status, their examples attached.
///
/// # Errors
///
/// As the writers of the responses and their examples.
pub(crate) fn success_responses(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    examples: &ExampleSet<'_>,
    location: &IrLocation,
) -> Result<IndexMap<i64, JsonObject>, OpenApiError> {
    let mut responses = IndexMap::new();
    let ir = context.ir;
    let Some(format) = ir.formats.get(operation.format.as_str()) else {
        refuse_inconsistent(
            context,
            "format.missing",
            &format!("The format '{}' is not declared", operation.format),
            location,
        );

        return Ok(responses);
    };

    for (index, response) in operation.responses.iter().enumerate() {
        let response_location = location.below(&["responses", &index.to_string()]);
        let mut response_object =
            success_response(context, operation, format, response, &response_location)?;
        let status_examples =
            response_examples(context, format, response, examples, &response_location)?;

        if let Some(status_examples) = status_examples {
            if has_body(&response_object, response.media.as_deref()) {
                attach_examples(
                    &mut response_object,
                    response.media.as_deref(),
                    status_examples,
                );
            } else {
                refuse_not_emitted(
                    context,
                    NotGeneratedForm::OpenapiExampleEmpty,
                    "An example of a response without a body",
                    &response_location,
                );
            }
        }

        responses.insert(response.status, response_object);
    }

    for entry in &examples.responses {
        if !responses.contains_key(&entry.status) {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleStatus,
                &format!(
                    "An example of the status {}, which no response has,",
                    entry.status
                ),
                &entry.location,
            );
        }
    }

    Ok(responses)
}

/// Whether the response object has a content object and the response names a media type.
fn has_body(response_object: &JsonObject, media: Option<&str>) -> bool {
    media.is_some() && matches!(response_object.get("content"), Some(JsonValue::Object(_)))
}

/// Sets `examples` on the media object of `media`, when the content holds one.
fn attach_examples(response_object: &mut JsonObject, media: Option<&str>, examples: JsonObject) {
    let Some(media) = media else {
        return;
    };
    let Some(JsonValue::Object(content)) = response_object.get_mut("content") else {
        return;
    };

    if let Some(JsonValue::Object(media_object)) = content.get_mut(media) {
        media_object.insert("examples".to_owned(), JsonValue::Object(examples));
    }
}
