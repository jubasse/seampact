//! The error responses of an operation and the error code components they reference.

use seampact_ir::{ErrorDecl, OperationError, WireFormat};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::{
    ComponentRequest, EmitContext, reference_component, refuse_inconsistent, refuse_not_emitted,
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
    let mut headers = JsonObject::new();

    if group.status != RATE_LIMITED_STATUS {
        return headers;
    }

    for entry in &group.errors {
        let Some(retry_header) = &entry.error.retry_header else {
            continue;
        };
        let mut schema = JsonObject::new();

        schema.insert("type".to_owned(), text_value("integer"));
        schema.insert("minimum".to_owned(), integer_value(0));

        let mut header = JsonObject::new();

        header.insert("schema".to_owned(), JsonValue::Object(schema));
        headers.insert(retry_header.name.clone(), JsonValue::Object(header));
    }

    headers
}

/// The item of an error list: its code and where it comes from.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a refusal or the origin text is written by a stub.
fn error_item(
    context: &mut EmitContext<'_>,
    error: &OperationError,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut item = JsonObject::new();

    item.insert("code".to_owned(), text_value(error.code.as_str()));

    if error.derived_from.is_none() && error.origin.is_none() {
        refuse_inconsistent(
            context,
            "error.provenance",
            "An operation error with neither derivedFrom nor origin",
            location,
        )?;
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

    let origin = error.origin.as_ref().map(origin_key).transpose()?;

    set_defined(&mut item, "origin", optional_text(origin.as_deref()));

    Ok(item)
}

/// The reference to the component of an error code, refusing a code answered in two formats.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a refusal is written by a stub.
fn error_code_reference<'ir>(
    context: &mut EmitContext<'ir>,
    format: &'ir WireFormat,
    declared: &'ir ErrorDecl,
) -> Result<JsonObject, OpenApiError> {
    let known = context.error_code_formats.get(declared.code.as_str());

    if let Some(known_format) =
        known.filter(|known_format| known_format.as_str() != format.id.as_str())
    {
        let description = format!(
            "The code '{}' answered in the formats '{known_format}' and '{}' in one document",
            declared.code, format.id,
        );
        let root = IrLocation {
            member: String::new(),
            operation: None,
        };

        refuse_not_emitted(
            context,
            "error.formats",
            &description,
            &root.below(&["errors", declared.code.as_str()]),
        )?;
    }

    context.error_code_formats.insert(
        declared.code.as_str().to_owned(),
        format.id.as_str().to_owned(),
    );

    let request = ComponentRequest {
        key: declared.code.as_str().to_owned(),
        build: Box::new(move |build_context| error_code_component(build_context, format, declared)),
    };

    Ok(reference_component(context, request))
}

/// The component of an error code in a format.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
fn error_code_component(
    _context: &mut EmitContext<'_>,
    _format: &WireFormat,
    _declared: &ErrorDecl,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("errorCodeComponent"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_rate_limited_status_has_retry_headers() {
        let other = StatusCodes {
            status: 503,
            errors: Vec::new(),
        };

        assert!(retry_headers(&other).is_empty());
    }
}
