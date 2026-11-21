//! The examples of an operation: the request examples and the success responses they belong to.

use indexmap::IndexMap;
use seampact_ir::{Operation, OperationExample, Response, WireFormat};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::OpenApiError;
use crate::body_slots::{EmittedShape, PAYLOAD_SLOT};
use crate::emit_context::{EmitContext, refuse_not_emitted};
use crate::templates::render_template;

/// An example that answers a success status.
pub(crate) struct ResponseExample<'operation> {
    /// The example's name.
    pub(crate) name: &'operation str,
    /// The status it answers.
    pub(crate) status: i64,
    /// The example.
    pub(crate) example: &'operation OperationExample,
    /// Where the example sits.
    pub(crate) location: IrLocation,
}

/// The examples of an operation, by the place they are written in.
pub(crate) struct ExampleSet<'operation> {
    /// The request examples by name, when the operation has any.
    pub(crate) request: Option<JsonObject>,
    /// The examples of the success responses.
    pub(crate) responses: Vec<ResponseExample<'operation>>,
}

/// Sorts the examples of an operation into request and response examples, refusing the rest.
pub(crate) fn collect_examples<'operation>(
    context: &mut EmitContext<'_>,
    operation: &'operation Operation,
    location: &IrLocation,
) -> ExampleSet<'operation> {
    let mut set = ExampleSet {
        request: None,
        responses: Vec::new(),
    };
    let default_status = operation.responses.first().map(|response| response.status);

    for (name, example) in &operation.examples {
        let example_location = location.below(&["examples", name]);

        if example.request == Some(true) {
            let value = JsonObject::from_iter([("value".to_owned(), example.value.clone())]);

            set.request
                .get_or_insert_with(JsonObject::new)
                .insert(name.clone(), JsonValue::Object(value));

            continue;
        }

        if example.error.is_some() {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleError,
                "An error example",
                &example_location,
            );

            continue;
        }

        let Some(status) = example.status.or(default_status) else {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleStatus,
                "An example without a success response",
                &example_location,
            );

            continue;
        };

        set.responses.push(ResponseExample {
            name,
            status,
            example,
            location: example_location,
        });
    }

    set
}

/// The examples of one response, rendered through the format's body template.
///
/// # Errors
///
/// As [`render_template`].
pub(crate) fn response_examples(
    context: &mut EmitContext<'_>,
    format: &WireFormat,
    response: &Response,
    set: &ExampleSet<'_>,
    location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    let own: Vec<&ResponseExample<'_>> = set
        .responses
        .iter()
        .filter(|entry| entry.status == response.status)
        .collect();

    if own.is_empty() {
        return Ok(None);
    }

    let Some(shape) =
        EmittedShape::of(&response.shape).filter(|shape| *shape != EmittedShape::Page)
    else {
        for entry in own {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleShape,
                &format!("An example of a '{}' response", response.shape),
                &entry.location,
            );
        }

        return Ok(None);
    };
    let template = &shape.success_of(&format.success).body;
    let mut examples = JsonObject::new();

    for entry in own {
        let values = IndexMap::from([(PAYLOAD_SLOT.to_owned(), entry.example.value.clone())]);
        let rendered = render_template(context, template, &values, &location.below(&["examples"]))?;

        if let Some(value) = rendered {
            let wrapped = JsonObject::from_iter([("value".to_owned(), value)]);

            examples.insert(entry.name.to_owned(), JsonValue::Object(wrapped));
        }
    }

    Ok(Some(examples))
}
