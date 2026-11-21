//! The request and response bodies of an operation.

use seampact_ir::{Operation, OperationInput};

use crate::emit_context::EmitContext;

/// The media type of the JSON bodies an input declares.
const JSON_MEDIA: &str = "application/json";

/// The media type an input is written with: the format's own when the input says plain JSON.
fn body_media<'ir>(
    context: &EmitContext<'ir>,
    operation: &Operation,
    input: &'ir OperationInput,
) -> &'ir str {
    if input.media.as_str() != JSON_MEDIA {
        return input.media.as_str();
    }

    context
        .ir
        .formats
        .get(operation.format.as_str())
        .map_or(input.media.as_str(), |format| format.media.as_str())
}
