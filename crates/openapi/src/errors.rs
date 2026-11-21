//! The error responses of an operation and the error code components they reference.

use indexmap::IndexMap;
use seampact_ir::{ErrorDecl, NatureId, Operation, OperationError, WireFormat};
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::emit_context::{
    ComponentRequest, EmitContext, SchemaVariant, reference_component, refuse_inconsistent,
    refuse_not_emitted, root_location, write_extension,
};
use crate::ir_text::origin_key;
use crate::json_value::{integer_value, optional_text, set_defined, text_value};
use crate::schemas::{schema_reference, write_docs};
use crate::templates::{SlotSchemas, SlotValue, members_writing_slot, template_schema};
use crate::{ExtensionName, OpenApiError};

/// The slot of an error body that holds the code.
const CODE_SLOT: &str = "code";

/// The slot of an error body that holds the code's params.
const PARAMS_SLOT: &str = "params";

/// The status that answers a rate limit, which carries the retry headers.
const RATE_LIMITED_STATUS: i64 = 429;

/// The errors of an operation that answer one status.
pub(crate) struct StatusCodes<'ir> {
    /// The status.
    pub(crate) status: i64,
    /// The errors, each with its index in the operation and its declaration.
    pub(crate) errors: Vec<StatusError<'ir>>,
}

/// One error of a [`StatusCodes`] group.
pub(crate) struct StatusError<'ir> {
    /// The error as the operation lists it.
    pub(crate) error: &'ir OperationError,
    /// The error's index in the operation.
    pub(crate) index: usize,
    /// The declaration of its code.
    pub(crate) declared: &'ir ErrorDecl,
}

/// The retry headers of a rate-limited status, one per error that names one.
fn retry_headers(group: &StatusCodes<'_>) -> JsonObject {
    if group.status != RATE_LIMITED_STATUS {
        return JsonObject::new();
    }

    group
        .errors
        .iter()
        .filter_map(|entry| entry.error.retry_header.as_ref())
        .map(|retry_header| {
            let schema = JsonObject::from_iter([
                ("type".to_owned(), text_value("integer")),
                ("minimum".to_owned(), integer_value(0)),
            ]);
            let header = JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);

            (retry_header.name.clone(), JsonValue::Object(header))
        })
        .collect()
}

/// The item of an error list: its code and where it comes from.
fn error_item(
    context: &mut EmitContext<'_>,
    error: &OperationError,
    location: &IrLocation,
) -> JsonObject {
    let mut item = JsonObject::from_iter([("code".to_owned(), text_value(error.code.as_str()))]);

    if error.derived_from.is_none() && error.origin.is_none() {
        refuse_inconsistent(
            context,
            "error.provenance",
            "An operation error with neither derivedFrom nor origin",
            location,
        );
    }

    set_defined(
        &mut item,
        "derivedFrom",
        optional_text(
            error
                .derived_from
                .as_ref()
                .map(|derived| derived.derivation.as_str()),
        ),
    );
    set_defined(
        &mut item,
        "origin",
        optional_text(error.origin.as_ref().map(origin_key).as_deref()),
    );

    item
}

/// The reference to the component of an error code, refusing a code answered in two formats.
fn error_code_reference<'ir>(
    context: &mut EmitContext<'ir>,
    format: &'ir WireFormat,
    declared: &'ir ErrorDecl,
) -> JsonObject {
    let known = context.error_code_formats.get(declared.code.as_str());

    if let Some(known_format) =
        known.filter(|known_format| known_format.as_str() != format.id.as_str())
    {
        let description = format!(
            "The code '{}' answered in the formats '{known_format}' and '{}' in one document",
            declared.code, format.id,
        );

        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiErrorFormats,
            &description,
            &root_location().below(&["errors", declared.code.as_str()]),
        );
    }

    context.error_code_formats.insert(
        declared.code.as_str().to_owned(),
        format.id.as_str().to_owned(),
    );

    let request = ComponentRequest {
        key: declared.code.as_str().to_owned(),
        build: Box::new(move |build_context| error_code_component(build_context, format, declared)),
    };

    reference_component(context, request)
}

/// The component of an error code in a format: the format's error body with the code's slots.
///
/// # Errors
///
/// As [`template_schema`].
fn error_code_component(
    context: &mut EmitContext<'_>,
    format: &WireFormat,
    declared: &ErrorDecl,
) -> Result<JsonObject, OpenApiError> {
    let params = match &declared.params {
        Some(schema) => SlotValue::always(schema_reference(
            context,
            schema.as_str(),
            SchemaVariant::Shared,
        )),
        None => SlotValue::never_sent(),
    };
    // RFC 9457 makes `title` optional: a code without a written title sends none.
    let title = match declared.title {
        Some(_) => SlotValue::always(string_schema()),
        None => SlotValue::never_sent(),
    };
    let code_schema = JsonObject::from_iter([
        ("type".to_owned(), text_value("string")),
        ("const".to_owned(), text_value(declared.code.as_str())),
    ]);
    let status_schema = JsonObject::from_iter([
        ("type".to_owned(), text_value("integer")),
        ("const".to_owned(), integer_value(declared.http.status)),
    ]);
    let slots = SlotSchemas::from_iter([
        (CODE_SLOT.to_owned(), SlotValue::always(code_schema)),
        ("title".to_owned(), title),
        ("status".to_owned(), SlotValue::always(status_schema)),
        ("nature".to_owned(), SlotValue::always(string_schema())),
        ("detail".to_owned(), SlotValue::maybe(string_schema())),
        ("instance".to_owned(), SlotValue::maybe(string_schema())),
        ("traceId".to_owned(), SlotValue::maybe(string_schema())),
        (PARAMS_SLOT.to_owned(), params),
    ]);
    let location = root_location().below(&["formats", format.id.as_str(), "error", "body"]);
    let mut schema = template_schema(
        context,
        &format.error.body,
        &slots,
        &format.absent,
        &location,
    )?
    .map(|value| value.schema)
    .unwrap_or_default();

    write_docs(&mut schema, Some(&declared.docs));

    let mut nature =
        JsonObject::from_iter([("base".to_owned(), text_value(declared.nature.as_str()))]);

    set_defined(
        &mut nature,
        "name",
        optional_text(declared.nature_name.as_ref().map(NatureId::as_str)),
    );
    write_extension(
        context,
        &mut schema,
        ExtensionName::Nature,
        JsonValue::Object(nature),
    );

    Ok(schema)
}

/// The `{ "type": "string" }` schema.
fn string_schema() -> JsonObject {
    JsonObject::from_iter([("type".to_owned(), text_value("string"))])
}

/// The error responses of an operation by status.
pub(crate) fn error_responses<'ir>(
    context: &mut EmitContext<'ir>,
    operation: &'ir Operation,
    location: &IrLocation,
) -> IndexMap<i64, JsonObject> {
    let mut responses = IndexMap::new();
    let ir = context.ir;

    // The success responses refused a missing format already.
    let Some(format) = ir.formats.get(operation.format.as_str()) else {
        return responses;
    };

    if !format.error.headers.is_empty() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiFormatErrorHeaders,
            "An error header written by the format",
            &root_location().below(&["formats", format.id.as_str(), "error", "headers"]),
        );
    }

    for group in codes_by_status(context, operation, location) {
        responses.insert(
            group.status,
            error_response(context, format, &group, location),
        );
    }

    responses
}

/// The errors of an operation grouped by status, the statuses and the codes in order.
fn codes_by_status<'ir>(
    context: &mut EmitContext<'ir>,
    operation: &'ir Operation,
    location: &IrLocation,
) -> Vec<StatusCodes<'ir>> {
    let ir = context.ir;
    let mut groups: IndexMap<i64, StatusCodes<'ir>> = IndexMap::new();

    for (index, error) in operation.errors.iter().enumerate() {
        let Some(declared) = ir.errors.get(error.code.as_str()) else {
            refuse_inconsistent(
                context,
                "error.missing",
                &format!("The error code '{}' is not declared", error.code),
                &location.below(&["errors", &index.to_string()]),
            );

            continue;
        };
        let status = declared.http.status;

        groups
            .entry(status)
            .or_insert_with(|| StatusCodes {
                status,
                errors: Vec::new(),
            })
            .errors
            .push(StatusError {
                error,
                index,
                declared,
            });
    }

    let mut ordered: Vec<StatusCodes<'ir>> = groups.into_values().collect();

    for group in &mut ordered {
        group
            .errors
            .sort_by(|left, right| cmp_utf16(left.error.code.as_str(), right.error.code.as_str()));
    }

    ordered.sort_by_key(|group| group.status);

    ordered
}

/// The response of one error status: a reference, or a `oneOf` the code discriminates.
fn error_response<'ir>(
    context: &mut EmitContext<'ir>,
    format: &'ir WireFormat,
    group: &StatusCodes<'ir>,
    location: &IrLocation,
) -> JsonObject {
    let references: Vec<JsonObject> = group
        .errors
        .iter()
        .map(|entry| error_code_reference(context, format, entry.declared))
        .collect();
    let mut schema = match references.as_slice() {
        [only] => only.clone(),
        _ => JsonObject::from_iter([(
            "oneOf".to_owned(),
            JsonValue::Array(references.iter().cloned().map(JsonValue::Object).collect()),
        )]),
    };
    let discriminator_member = members_writing_slot(&format.error.body, CODE_SLOT).pop();

    if let (true, Some(member)) = (references.len() > 1, discriminator_member) {
        let discriminator =
            JsonObject::from_iter([("propertyName".to_owned(), text_value(member))]);

        schema.insert("discriminator".to_owned(), JsonValue::Object(discriminator));
    }

    let codes: Vec<&str> = group
        .errors
        .iter()
        .map(|entry| entry.error.code.as_str())
        .collect();
    let mut response =
        JsonObject::from_iter([("description".to_owned(), text_value(&codes.join(", ")))]);
    let headers = retry_headers(group);

    if !headers.is_empty() {
        response.insert("headers".to_owned(), JsonValue::Object(headers));
    }

    let media_entry = JsonObject::from_iter([("schema".to_owned(), JsonValue::Object(schema))]);
    let media_by_type =
        JsonObject::from_iter([(format.error.media.clone(), JsonValue::Object(media_entry))]);

    response.insert("content".to_owned(), JsonValue::Object(media_by_type));

    let items: Vec<JsonValue> = group
        .errors
        .iter()
        .map(|entry| {
            let item_location = location.below(&["errors", &entry.index.to_string()]);

            JsonValue::Object(error_item(context, entry.error, &item_location))
        })
        .collect();

    write_extension(
        context,
        &mut response,
        ExtensionName::Errors,
        JsonValue::Array(items),
    );

    response
}

#[cfg(test)]
mod tests {
    use seampact_ir::ErrorCode;

    use crate::EmitterOptions;
    use crate::emit_context::{create_emit_context, fixture_ir};

    use super::*;

    fn declared_with_status(ir: &mut seampact_ir::ContractIr, code: &str, status: i64) {
        let Some(mut declaration) = ir.errors.values().next().cloned() else {
            return;
        };

        declaration.code = ErrorCode::new(code.to_owned());
        declaration.http.status = status;
        ir.errors.insert(declaration.code.clone(), declaration);
    }

    #[test]
    fn statuses_sort_as_numbers_and_codes_by_utf16_code_units()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut ir = fixture_ir()?;

        declared_with_status(&mut ir, "\u{e000}", 400);
        declared_with_status(&mut ir, "\u{10000}", 400);
        declared_with_status(&mut ir, "x", 1000);
        declared_with_status(&mut ir, "y", 200);

        let mut operation = ir.operations.first().cloned().ok_or("no operation")?;
        let error: OperationError = serde_json::from_str(r#"{"code":"x"}"#)?;

        operation.errors = ["\u{e000}", "\u{10000}", "x", "y"]
            .into_iter()
            .map(|code| OperationError {
                code: ErrorCode::new(code.to_owned()),
                ..error.clone()
            })
            .collect();

        let options = EmitterOptions::default();
        let mut context = create_emit_context(&ir, &options);
        let location = IrLocation::operation_location(0, operation.id.clone());
        let groups = codes_by_status(&mut context, &operation, &location);
        let written: Vec<(i64, Vec<&str>)> = groups
            .iter()
            .map(|group| {
                let codes = group
                    .errors
                    .iter()
                    .map(|entry| entry.error.code.as_str())
                    .collect();

                (group.status, codes)
            })
            .collect();

        assert_eq!(
            written,
            vec![
                (200, vec!["y"]),
                (400, vec!["\u{10000}", "\u{e000}"]),
                (1000, vec!["x"]),
            ]
        );

        Ok(())
    }
}
