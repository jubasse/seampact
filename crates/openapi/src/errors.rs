//! The error responses of an operation and the error code components they reference.

use seampact_ir::{ErrorDecl, OperationError, WireFormat};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::OpenApiError;
use crate::emit_context::{
    ComponentRequest, EmitContext, reference_component, refuse_inconsistent, refuse_not_emitted,
    root_location,
};
use crate::ir_text::origin_key;
use crate::json_value::{integer_value, optional_text, set_defined, text_value};
use crate::not_ported::not_ported_yet;

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

/// The component of an error code in a format.
fn error_code_component(
    _context: &mut EmitContext<'_>,
    _format: &WireFormat,
    _declared: &ErrorDecl,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("errorCodeComponent"))
}
