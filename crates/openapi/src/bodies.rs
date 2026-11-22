//! The request and response bodies of an operation.

use seampact_ir::{
    FieldWire, FieldWireKind, InputProof, KnownSchemaRef, Operation, OperationInput, TypeUse,
    UnknownKeys, UnknownKeysPolicy,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::emit_context::{
    EmitContext, SchemaVariant, reason_value, refuse_inconsistent, refuse_not_emitted,
    refuse_unknown, write_extension,
};
use crate::ir_text::derived_from_value;
use crate::schemas::{
    mark_sensitive, object_schema, refuses_unknown_keys, schema_reference, type_use_schema,
};
use crate::{ExtensionName, InputSchemasOption, OpenApiError};

/// The media type of the JSON bodies an input declares.
const JSON_MEDIA: &str = "application/json";

/// The media type of a form body.
const FORM_MEDIA: &str = "application/x-www-form-urlencoded";

/// The media type of a multipart body.
const MULTIPART_MEDIA: &str = "multipart/form-data";

/// The schema of an input with no member of its own, which only proofs fill.
const EMPTY_BODY_SCHEMA_ID: &str = "ApiEmptyBody";

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
    let encoding = body_encoding(context, input, &input_location);

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
        );
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

/// How the top level of an input with proofs reads its object schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InputTopLevel {
    /// The shared component.
    Shared,
    /// The object written in place, without its own `additionalProperties: false`.
    Strict,
}

/// The schema of a request body: the input's own, or the input and its proofs under `allOf`.
///
/// # Errors
///
/// As the writers of the type use schema and of the top level of an input.
fn body_schema(
    context: &mut EmitContext<'_>,
    input: &OperationInput,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let proofs = input.proofs.as_deref().unwrap_or_default();

    if proofs.is_empty() {
        return type_use_schema(
            context,
            &input.schema,
            SchemaVariant::Input,
            &location.below(&["schema"]),
        );
    }

    // An input that ignores or keeps unknown keys reads the shared top level even under strict input.
    let strict = context.options.input_schemas == InputSchemasOption::Strict
        && refuses_unknown_keys(&input.schema);
    let mut proof_object = proofs_schema(context, proofs, &location.below(&["proofs"]))?;
    let input_schema_id = match &input.schema {
        TypeUse::Ref(reference) => Some(reference.schema.as_str()),
        _ => None,
    };

    if input_schema_id == Some(EMPTY_BODY_SCHEMA_ID) {
        if strict {
            proof_object.insert("unevaluatedProperties".to_owned(), JsonValue::Bool(false));
        }

        return Ok(proof_object);
    }

    let top_level = if strict {
        InputTopLevel::Strict
    } else {
        InputTopLevel::Shared
    };
    let top = input_top_level(context, input, input_schema_id, top_level, location)?;
    let mut wrapper = JsonObject::from_members([(
        "allOf",
        JsonValue::Array(vec![
            JsonValue::Object(top),
            JsonValue::Object(proof_object),
        ]),
    )]);

    if strict {
        wrapper.insert("unevaluatedProperties".to_owned(), JsonValue::Bool(false));
    }

    Ok(wrapper)
}

/// The object schema of the body proofs, each sensitive and marked with where it derives from.
///
/// # Errors
///
/// As the writer of the type use schema.
fn proofs_schema(
    context: &mut EmitContext<'_>,
    proofs: &[InputProof],
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut properties = JsonObject::new();

    for (index, proof) in proofs.iter().enumerate() {
        let schema_location = location.below(&[&index.to_string(), "schema"]);
        let mut schema = type_use_schema(
            context,
            &proof.schema,
            SchemaVariant::Input,
            &schema_location,
        )?;

        // Every proof is sensitive (ADR 0002 section 9).
        mark_sensitive(context, &mut schema, &schema_location);
        write_extension(
            context,
            &mut schema,
            ExtensionName::DerivedFrom,
            JsonValue::Object(derived_from_value(&proof.derived_from)),
        );
        properties.insert(proof.name.clone(), JsonValue::Object(schema));
    }

    let required = proofs
        .iter()
        .map(|proof| JsonValue::text(&proof.name))
        .collect();

    Ok(JsonObject::from_members([
        ("type", JsonValue::text("object")),
        ("properties", JsonValue::Object(properties)),
        ("required", JsonValue::Array(required)),
    ]))
}

/// The top level of an input with proofs: the shared schema, or the object written in place.
///
/// # Errors
///
/// As the writers of the type use schema and of the object schema.
fn input_top_level(
    context: &mut EmitContext<'_>,
    input: &OperationInput,
    input_schema_id: Option<&str>,
    top_level: InputTopLevel,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let ir = context.ir;
    let object = match input_schema_id
        .and_then(|id| ir.schemas.get(id))
        .map(KnownSchemaRef::try_from)
    {
        Some(Ok(KnownSchemaRef::Object(object))) => Some(object),
        _ => None,
    };
    let (Some(schema_id), Some(named)) = (input_schema_id, object) else {
        refuse_inconsistent(
            context,
            "input.proofs",
            "A body proof on an input that is not an object schema",
            location,
        );

        return Ok(JsonObject::new());
    };

    if top_level == InputTopLevel::Shared {
        return type_use_schema(
            context,
            &input.schema,
            SchemaVariant::Input,
            &location.below(&["schema"]),
        );
    }

    // The shared component stays in the document, as without the option.
    schema_reference(context, schema_id, SchemaVariant::Shared);

    let mut in_place = object_schema(
        context,
        named,
        SchemaVariant::Input,
        &IrLocation::schema_location(schema_id),
    )?;

    in_place.remove("additionalProperties");

    Ok(in_place)
}

/// The `encoding` of a form or multipart body: styles of form lists and objects, media of files.
fn body_encoding(
    context: &mut EmitContext<'_>,
    input: &OperationInput,
    location: &IrLocation,
) -> JsonObject {
    let mut encoding = JsonObject::new();

    if input.media.as_str() == FORM_MEDIA {
        let mut fields: Vec<(&str, &FieldWire, IrLocation)> = Vec::new();

        for (index, field) in input
            .fields
            .as_deref()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            fields.push((
                &field.name,
                &field.wire,
                location.below(&["fields", &index.to_string()]),
            ));
        }

        for (index, proof) in input
            .proofs
            .as_deref()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            if let Some((name, wire)) = proof_field(proof) {
                fields.push((name, wire, location.below(&["proofs", &index.to_string()])));
            }
        }

        for (name, wire, field_location) in fields {
            if let Some(field_encoding) = form_field_encoding(context, name, wire, &field_location)
            {
                encoding.insert(name.to_owned(), JsonValue::Object(field_encoding));
            }
        }
    }

    if input.media.as_str() == MULTIPART_MEDIA {
        for field in input.fields.as_deref().unwrap_or_default() {
            if field.wire.kind != FieldWireKind::File {
                continue;
            }

            let media = file_field_media(context, input, &field.name, location);

            if let Some(media) = media.filter(|media| !media.is_empty()) {
                let content_type =
                    JsonObject::from_members([("contentType", JsonValue::text(&media.join(", ")))]);

                encoding.insert(field.name.clone(), JsonValue::Object(content_type));
            }
        }
    }

    encoding
}

/// The field a proof writes in a form body, if it has a wire.
fn proof_field(proof: &InputProof) -> Option<(&str, &FieldWire)> {
    proof.wire.as_ref().map(|wire| (proof.name.as_str(), wire))
}

/// The field kinds a form body writes with a style and explode.
const ENCODED_FIELD_KINDS: [FieldWireKind; 2] = [FieldWireKind::List, FieldWireKind::Object];

/// The `encoding` entry of a form field: its style and explode, for a list or an object.
fn form_field_encoding(
    context: &mut EmitContext<'_>,
    name: &str,
    wire: &FieldWire,
    location: &IrLocation,
) -> Option<JsonObject> {
    if !ENCODED_FIELD_KINDS.contains(&wire.kind) {
        return None;
    }

    let wire_location = location.below(&["wire"]);

    if wire.brackets == Some(true) {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiInputBrackets,
            "A form field named with brackets",
            &wire_location,
        );

        return None;
    }

    let (Some(style), Some(explode)) = (&wire.style, wire.explode) else {
        refuse_inconsistent(
            context,
            "input.field-wire",
            &format!("The form field '{name}' has no style or explode"),
            &wire_location,
        );

        return None;
    };

    Some(JsonObject::from_members([
        ("style", JsonValue::text(style.as_str())),
        ("explode", JsonValue::Bool(explode)),
    ]))
}

/// The media types the file property `field_name` of the input's schema accepts.
fn file_field_media<'ir>(
    context: &mut EmitContext<'ir>,
    input: &OperationInput,
    field_name: &str,
    location: &IrLocation,
) -> Option<&'ir [String]> {
    let property_type = input_object_property_type(context, input, field_name);

    if let Some(TypeUse::File(file)) = property_type {
        return Some(&file.media);
    }

    refuse_inconsistent(
        context,
        "input.file",
        &format!("The file field '{field_name}' has no file property"),
        location,
    );

    None
}

fn input_object_property_type<'ir>(
    context: &EmitContext<'ir>,
    input: &OperationInput,
    field_name: &str,
) -> Option<&'ir TypeUse> {
    let TypeUse::Ref(reference) = &input.schema else {
        return None;
    };
    let named = context.ir.schemas.get(reference.schema.as_str())?;
    let Ok(KnownSchemaRef::Object(object)) = KnownSchemaRef::try_from(named) else {
        return None;
    };

    object
        .properties
        .iter()
        .find(|candidate| candidate.name == field_name)
        .map(|property| &property.r#type)
}

/// The `x-seampact-unknown-keys` of a body whose input ignores or keeps unknown keys.
fn write_unknown_keys(
    context: &mut EmitContext<'_>,
    body: &mut JsonObject,
    unknown_keys: &UnknownKeys,
    location: &IrLocation,
) {
    let policy = match &unknown_keys.policy {
        UnknownKeysPolicy::Unknown(unknown) => {
            refuse_unknown(
                context,
                &location.below(&["unknownKeys", "policy"]),
                unknown.as_str(),
            );

            return;
        }
        UnknownKeysPolicy::Refuse => return,
        UnknownKeysPolicy::Ignore => "ignore",
        UnknownKeysPolicy::Keep => "keep",
    };
    let reason = match &unknown_keys.reason {
        Some(text) => reason_value(context, text.as_str()),
        None => JsonValue::Bool(true),
    };
    let written = JsonObject::from_members([(policy, reason)]);

    write_extension(
        context,
        body,
        ExtensionName::UnknownKeys,
        JsonValue::Object(written),
    );
}
