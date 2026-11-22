//! The JSON Schemas of type uses and named schemas.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, Direction, Docs, Enum, EnumTypeUse, Extensions, Int64Wire, KnownSchemaRef,
    KnownTypeUseRef, KnownUnionTagRef, ObjectSchema, OutputEnumForm, Property, RefTypeUse,
    Refinements, ScalarTypeUse, TypeUse, UnionSchema, UnknownKeysPolicy,
};
use seampact_js::js_number_of_text;
use seampact_json::{JsonNumber, JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::emit_context::{
    ComponentRequest, EmitContext, SchemaVariant, reason_value, reference_component,
    refuse_inconsistent, refuse_not_emitted, refuse_unknown, write_consumer_extensions,
    write_extension,
};
use crate::json_value::{optional_integer, optional_text, set_defined, text_value};
use crate::not_ported::not_ported_yet;
use crate::{ExtensionName, InputSchemasOption, OpenApiError};

/// The suffix of the key of the strict input twin of a component.
const INPUT_COMPONENT_SUFFIX: &str = ".input";

/// The `format` of a 64-bit integer.
const INT64_FORMAT: &str = "int64";

/// The `format` of an exact decimal.
const DECIMAL_FORMAT: &str = "decimal";

/// The `format` of a sensitive scalar.
const PASSWORD_FORMAT: &str = "password";

/// The keywords that annotate a schema without asserting anything.
const ANNOTATION_KEYWORDS: [&str; 4] = ["title", "description", "examples", "default"];

/// The `type` of the JSON `null`.
const NULL_TYPE: &str = "null";

/// The pattern of an int64 written as a string.
const INT64_PATTERN: &str = "^-?(0|[1-9][0-9]*)$";

/// The pattern of a decimal written as a string.
const DECIMAL_PATTERN: &str = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$";

/// The largest integer a JavaScript number holds exactly.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Whether the text is an integer literal: an optional minus and decimal digits.
fn is_integer_literal(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);

    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

/// Whether a number is an integer a JavaScript number holds exactly.
fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER
}

/// The number a decimal literal denotes: the exact integer when a JavaScript number cannot hold it.
///
/// # Errors
///
/// [`OpenApiError::Internal`] for a literal that is no finite number, which the IR does not hold.
pub(crate) fn number_literal(literal: Option<&str>) -> Result<Option<JsonValue>, OpenApiError> {
    let Some(text) = literal else {
        return Ok(None);
    };
    let value = js_number_of_text(text);

    if is_integer_literal(text) && !is_safe_integer(value) {
        return exact_integer(text).map(Some);
    }

    JsonNumber::from_f64(value)
        .map(|number| Some(JsonValue::Number(number)))
        .ok_or_else(|| {
            InternalError::new(format!("the decimal literal '{text}' is no finite number")).into()
        })
}

// `BigInt(text)`: the sign, then the digits without leading zeros.
fn exact_integer(text: &str) -> Result<JsonValue, OpenApiError> {
    let (sign, digits) = text
        .strip_prefix('-')
        .map_or(("", text), |rest| ("-", rest));
    let significant = digits.trim_start_matches('0');
    let exact = format!("{sign}{significant}");

    JsonNumber::from_json_text(&exact)
        .map(JsonValue::Number)
        .ok_or_else(|| {
            InternalError::new(format!("the integer literal '{text}' is no JSON number")).into()
        })
}

/// Whether a type use refuses the keys its schema does not name: a reference with no policy does.
pub(crate) fn refuses_unknown_keys(use_: &TypeUse) -> bool {
    match use_ {
        TypeUse::Ref(reference) => reference_refuses_unknown_keys(reference),
        _ => true,
    }
}

fn reference_refuses_unknown_keys(reference: &RefTypeUse) -> bool {
    reference
        .unknown_keys
        .as_ref()
        .is_none_or(|keys| keys.policy == UnknownKeysPolicy::Refuse)
}

/// Writes the `title` and `description` of docs.
pub(crate) fn write_docs(schema: &mut JsonObject, docs: Option<&Docs>) {
    set_defined(
        schema,
        "title",
        optional_text(docs.and_then(|docs| docs.summary.as_deref())),
    );
    set_defined(
        schema,
        "description",
        optional_text(docs.and_then(|docs| docs.description.as_deref())),
    );
}

/// Writes the length and pattern refinements.
fn write_length_refinements(schema: &mut JsonObject, refinements: &Refinements) {
    set_defined(
        schema,
        "minLength",
        optional_integer(refinements.min_length),
    );
    set_defined(
        schema,
        "maxLength",
        optional_integer(refinements.max_length),
    );
    set_defined(
        schema,
        "pattern",
        optional_text(
            refinements
                .pattern
                .as_ref()
                .map(|pattern| pattern.normalized.as_str()),
        ),
    );
}

/// Writes the numeric refinements.
fn write_numeric_refinements(
    schema: &mut JsonObject,
    refinements: &Refinements,
) -> Result<(), OpenApiError> {
    let members = [
        ("minimum", &refinements.minimum),
        ("maximum", &refinements.maximum),
        ("exclusiveMinimum", &refinements.exclusive_minimum),
        ("exclusiveMaximum", &refinements.exclusive_maximum),
        ("multipleOf", &refinements.multiple_of),
    ];

    for (member, literal) in members {
        set_defined(
            schema,
            member,
            number_literal(literal.as_ref().map(seampact_ir::DecimalLiteral::as_str))?,
        );
    }

    Ok(())
}

/// The schema of an array type use.
fn array_schema(
    context: &mut EmitContext<'_>,
    use_: &ArrayTypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let items = type_use_schema(context, &use_.items, variant, &location.below(&["items"]))?;
    let mut schema = JsonObject::from_iter([
        ("type".to_owned(), text_value("array")),
        ("items".to_owned(), JsonValue::Object(items)),
    ]);

    set_defined(&mut schema, "minItems", optional_integer(use_.min_items));
    set_defined(&mut schema, "maxItems", optional_integer(use_.max_items));

    Ok(schema)
}

/// The schema of a type use, with its docs and examples, nullable when the use says so.
pub(crate) fn type_use_schema(
    context: &mut EmitContext<'_>,
    use_: &TypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let Ok(known) = KnownTypeUseRef::try_from(use_) else {
        refuse_unknown(context, &location.below(&["kind"]), use_.tag());

        return Ok(JsonObject::new());
    };
    let mut schema = known_use_schema(context, &known, variant, location)?;
    let (docs, examples, nullable) = type_use_marks(&known);

    write_docs(&mut schema, docs);

    if let Some(examples) = examples {
        let written: Result<Vec<JsonValue>, OpenApiError> = examples
            .iter()
            .map(|example| wire_value(context, use_, example))
            .collect();

        schema.insert("examples".to_owned(), JsonValue::Array(written?));
    }

    if nullable == Some(true) {
        return Ok(nullable_schema(schema));
    }

    Ok(schema)
}

// The docs, examples and nullability every known type use carries.
fn type_use_marks<'use_>(
    known: &KnownTypeUseRef<'use_>,
) -> (
    Option<&'use_ Docs>,
    Option<&'use_ Vec<JsonValue>>,
    Option<bool>,
) {
    match known {
        KnownTypeUseRef::Ref(use_) => (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable),
        KnownTypeUseRef::Opaque(use_) => {
            (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable)
        }
        KnownTypeUseRef::File(use_) => (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable),
        KnownTypeUseRef::Enum(use_) => (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable),
        KnownTypeUseRef::Scalar(use_) => {
            (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable)
        }
        KnownTypeUseRef::Array(use_) => (use_.docs.as_ref(), use_.examples.as_ref(), use_.nullable),
    }
}

/// The schema of a named schema, by its kind.
fn known_schema_component(
    context: &mut EmitContext<'_>,
    named: &KnownSchemaRef<'_>,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    match named {
        KnownSchemaRef::Object(object) => object_schema(context, object, variant, location),
        KnownSchemaRef::Map(map) => map_schema(context, map, variant, location),
        KnownSchemaRef::Union(union) => union_schema(context, union, variant, location),
    }
}

/// The `$ref` to a named schema, the strict twin when the schema is an input.
pub(crate) fn schema_reference(
    context: &mut EmitContext<'_>,
    schema_id: &str,
    variant: SchemaVariant,
) -> JsonObject {
    let ir = context.ir;
    let shared_id = schema_id.to_owned();
    let shared = reference_component(
        context,
        ComponentRequest {
            key: schema_id.to_owned(),
            build: Box::new(move |build_context| {
                named_schema_component(build_context, &shared_id, SchemaVariant::Shared)
            }),
        },
    );
    let strict = variant == SchemaVariant::Input
        && context.options.input_schemas == InputSchemasOption::Strict
        && ir
            .schemas
            .get(schema_id)
            .and_then(|named| KnownSchemaRef::try_from(named).ok())
            .is_some_and(|known| schema_marks(&known).directions.contains(&Direction::Input));

    // The strict twin is a second component: the shared one stays, as every other option leaves it.
    if !strict {
        return shared;
    }

    let input_id = schema_id.to_owned();

    reference_component(
        context,
        ComponentRequest {
            key: format!("{schema_id}{INPUT_COMPONENT_SUFFIX}"),
            build: Box::new(move |build_context| {
                named_schema_component(build_context, &input_id, SchemaVariant::Input)
            }),
        },
    )
}

/// The schema of a reference use: the named schema's component, or `{}` for one not declared.
fn ref_schema(
    context: &mut EmitContext<'_>,
    use_: &RefTypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> JsonObject {
    if context.ir.schemas.get(use_.schema.as_str()).is_none() {
        refuse_inconsistent(
            context,
            "schema.missing",
            &format!("The schema '{}' is not declared", use_.schema),
            location,
        );

        return JsonObject::new();
    }

    // An ignoring or keeping use accepts unknown keys, so it reads the shared component even under strict input.
    let referenced = if variant == SchemaVariant::Input && reference_refuses_unknown_keys(use_) {
        SchemaVariant::Input
    } else {
        SchemaVariant::Shared
    };

    schema_reference(context, use_.schema.as_str(), referenced)
}

/// The schema of a known type use, by its kind.
fn known_use_schema(
    context: &mut EmitContext<'_>,
    use_: &KnownTypeUseRef<'_>,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    match use_ {
        KnownTypeUseRef::Ref(reference) => Ok(ref_schema(context, reference, variant, location)),
        KnownTypeUseRef::Opaque(opaque) => {
            let mut schema = JsonObject::new();
            let reason = reason_value(context, opaque.reason.as_str());

            write_extension(context, &mut schema, ExtensionName::Opaque, reason);

            Ok(schema)
        }
        KnownTypeUseRef::File(file) => file_schema(context, &file.media, file.max_size_bytes),
        KnownTypeUseRef::Enum(enum_use) => {
            Ok(enum_use_schema(context, enum_use, variant, location))
        }
        KnownTypeUseRef::Scalar(scalar) => scalar_schema(context, scalar, variant, location),
        KnownTypeUseRef::Array(array) => array_schema(context, array, variant, location),
    }
}

/// The schema of a scalar type use: its type and format, refinements and JSON content.
fn scalar_schema(
    context: &mut EmitContext<'_>,
    use_: &ScalarTypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let format = use_.format.as_deref();

    if format == Some(INT64_FORMAT) && context.ir.api.wire.int64 == Int64Wire::String {
        return string_number_schema(context, INT64_FORMAT, INT64_PATTERN, &use_.refinements);
    }

    if format == Some(DECIMAL_FORMAT) {
        return string_number_schema(context, DECIMAL_FORMAT, DECIMAL_PATTERN, &use_.refinements);
    }

    let mut schema = JsonObject::from_iter([("type".to_owned(), text_value(use_.r#type.as_str()))]);
    let written_format = if use_.sensitive == Some(true) {
        Some(PASSWORD_FORMAT)
    } else {
        format
    };

    set_defined(&mut schema, "format", optional_text(written_format));
    write_length_refinements(&mut schema, &use_.refinements);
    write_numeric_refinements(&mut schema, &use_.refinements)?;

    if let Some(content) = &use_.content {
        let content_schema = type_use_schema(
            context,
            &content.schema,
            variant,
            &location.below(&["content", "schema"]),
        )?;

        schema.insert(
            "contentMediaType".to_owned(),
            text_value(content.media.as_str()),
        );
        schema.insert(
            "contentSchema".to_owned(),
            JsonValue::Object(content_schema),
        );
    }

    Ok(schema)
}

/// The schema of a property: its type, nullability, docs, default, examples and extensions.
pub(crate) fn property_schema(
    context: &mut EmitContext<'_>,
    property: &Property,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut type_schema = type_use_schema(
        context,
        &property.r#type,
        variant,
        &location.below(&["type"]),
    )?;

    if property.sensitive {
        mark_sensitive(context, &mut type_schema, &location.below(&["sensitive"]));
    }

    let mut schema = if property.nullable {
        nullable_schema(type_schema)
    } else {
        type_schema
    };

    write_docs(&mut schema, Some(&property.docs));

    if let Some(default) = &property.default {
        schema.insert(
            "default".to_owned(),
            wire_value(context, &property.r#type, default)?,
        );
    }

    if let Some(examples) = &property.examples {
        let written: Result<Vec<JsonValue>, OpenApiError> = examples
            .iter()
            .map(|example| wire_value(context, &property.r#type, example))
            .collect();

        schema.insert("examples".to_owned(), JsonValue::Array(written?));
    }

    if property.deprecated {
        schema.insert("deprecated".to_owned(), JsonValue::Bool(true));
    }

    write_consumer_extensions(&mut schema, &property.extensions);

    Ok(schema)
}

/// The schema of an object: its properties, the required ones, and a closed shape for input.
fn object_schema(
    context: &mut EmitContext<'_>,
    named: &ObjectSchema,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut schema = JsonObject::from_iter([("type".to_owned(), text_value("object"))]);

    write_docs(&mut schema, Some(&named.docs));

    let mut properties = JsonObject::new();

    for (index, property) in named.properties.iter().enumerate() {
        let property_location = location.below(&["properties", &index.to_string()]);
        let written = property_schema(context, property, variant, &property_location)?;

        properties.insert(property.name.clone(), JsonValue::Object(written));
    }

    schema.insert("properties".to_owned(), JsonValue::Object(properties));

    let required: Vec<JsonValue> = named
        .properties
        .iter()
        .filter(|property| !property.optional)
        .map(|property| text_value(&property.name))
        .collect();

    if !required.is_empty() {
        schema.insert("required".to_owned(), JsonValue::Array(required));
    }

    if variant == SchemaVariant::Input {
        schema.insert("additionalProperties".to_owned(), JsonValue::Bool(false));
    }

    Ok(schema)
}

/// The component of a named schema, with its deprecation, examples and consumer extensions.
pub(crate) fn named_schema_component(
    context: &mut EmitContext<'_>,
    schema_id: &str,
    variant: SchemaVariant,
) -> Result<JsonObject, OpenApiError> {
    let ir = context.ir;
    let location = IrLocation::schema_location(schema_id);
    let Some(named) = ir.schemas.get(schema_id) else {
        refuse_inconsistent(
            context,
            "schema.missing",
            &format!("The schema '{schema_id}' is not declared"),
            &location,
        );

        return Ok(JsonObject::new());
    };
    let Ok(known) = KnownSchemaRef::try_from(named) else {
        refuse_unknown(context, &location.below(&["kind"]), named.tag());

        return Ok(JsonObject::new());
    };
    let mut schema = known_schema_component(context, &known, variant, &location)?;
    let marks = schema_marks(&known);

    if marks.deprecated == Some(true) {
        schema.insert("deprecated".to_owned(), JsonValue::Bool(true));
    }

    if !marks.examples.is_empty() {
        schema.insert(
            "examples".to_owned(),
            JsonValue::Array(marks.examples.to_vec()),
        );
    }

    write_consumer_extensions(&mut schema, marks.extensions);

    Ok(schema)
}

/// The members every named schema kind carries.
struct SchemaMarks<'schema> {
    directions: &'schema [Direction],
    deprecated: Option<bool>,
    examples: &'schema [JsonValue],
    extensions: &'schema Extensions,
}

fn schema_marks<'schema>(known: &KnownSchemaRef<'schema>) -> SchemaMarks<'schema> {
    match known {
        KnownSchemaRef::Object(named) => SchemaMarks {
            directions: &named.directions,
            deprecated: named.deprecated,
            examples: &named.examples,
            extensions: &named.extensions,
        },
        KnownSchemaRef::Map(named) => SchemaMarks {
            directions: &named.directions,
            deprecated: named.deprecated,
            examples: &named.examples,
            extensions: &named.extensions,
        },
        KnownSchemaRef::Union(named) => SchemaMarks {
            directions: &named.directions,
            deprecated: named.deprecated,
            examples: &named.examples,
            extensions: &named.extensions,
        },
    }
}

fn file_schema(
    _context: &mut EmitContext<'_>,
    _media: &[String],
    _max_size_bytes: Option<i64>,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("fileSchema"))
}

/// Whether an output enum is open and `declared` is used as an output.
fn is_open_enum(context: &EmitContext<'_>, declared: &Enum) -> bool {
    context.ir.api.wire.output_enums == OutputEnumForm::Open
        && declared.directions.contains(&Direction::Output)
}

/// The component of a declared enum: closed with `enum`, or open with the `enum` extension.
fn enum_component(context: &mut EmitContext<'_>, declared: &Enum) -> JsonObject {
    let mut schema = JsonObject::from_members([("type", JsonValue::text("string"))]);
    let values = text_array(&declared.values);

    if is_open_enum(context, declared) {
        write_extension(context, &mut schema, ExtensionName::Enum, values);

        if let Some(fallback) = &declared.fallback {
            write_extension(
                context,
                &mut schema,
                ExtensionName::EnumFallback,
                JsonValue::text(fallback),
            );
        }
    } else {
        schema.insert("enum".to_owned(), values);
    }

    write_docs(&mut schema, Some(&declared.docs));

    schema
}

/// The reference to an enum component, closed to its narrowed values or, under strict input, to
/// all its values.
fn enum_use_schema(
    context: &mut EmitContext<'_>,
    use_: &EnumTypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> JsonObject {
    let ir = context.ir;
    let Some(declared) = ir.enums.get(use_.r#enum.as_str()) else {
        refuse_inconsistent(
            context,
            "enum.missing",
            &format!("The enum '{}' is not declared", use_.r#enum),
            location,
        );

        return JsonObject::new();
    };
    let mut reference = reference_component(
        context,
        ComponentRequest {
            key: use_.r#enum.as_str().to_owned(),
            build: Box::new(move |build_context| Ok(enum_component(build_context, declared))),
        },
    );

    if let Some(narrowed) = &use_.narrowed_to {
        reference.insert("enum".to_owned(), text_array(&narrowed.values));

        return reference;
    }

    // Strict input closes an open enum at its input uses, as the boundary refuses an unknown value there.
    let strict_input = variant == SchemaVariant::Input
        && context.options.input_schemas == InputSchemasOption::Strict;

    if strict_input && is_open_enum(context, declared) {
        reference.insert("enum".to_owned(), text_array(&declared.values));
    }

    reference
}

fn string_number_schema(
    _context: &mut EmitContext<'_>,
    _format: &str,
    _pattern: &str,
    _refinements: &Refinements,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("stringNumberSchema"))
}

/// Marks a scalar schema `password`; refuses any other shape.
pub(crate) fn mark_sensitive(
    context: &mut EmitContext<'_>,
    schema: &mut JsonObject,
    location: &IrLocation,
) {
    if matches!(schema.get("type"), Some(JsonValue::String(_))) {
        schema.insert("format".to_owned(), JsonValue::text(PASSWORD_FORMAT));

        return;
    }

    refuse_not_emitted(
        context,
        NotGeneratedForm::OpenapiSensitiveShape,
        "A sensitive value that is not a scalar",
        location,
    );
}

pub(crate) fn wire_value(
    _context: &EmitContext<'_>,
    _use: &TypeUse,
    _value: &JsonValue,
) -> Result<JsonValue, OpenApiError> {
    Err(not_ported_yet("wireValue"))
}

/// Whether a schema holds annotations and extensions only, so it already accepts any value.
fn accepts_any_value(schema: &JsonObject) -> bool {
    schema
        .keys()
        .all(|keyword| ANNOTATION_KEYWORDS.contains(&keyword.as_str()) || keyword.starts_with("x-"))
}

/// The schema widened to accept `null`.
pub(crate) fn nullable_schema(schema: JsonObject) -> JsonObject {
    if accepts_any_value(&schema) {
        return schema;
    }

    if let Some(JsonValue::String(type_name)) = schema.get("type")
        && !schema.contains_key("const")
    {
        let mut nullable = schema.clone();
        let types = [JsonValue::text(type_name), JsonValue::text(NULL_TYPE)];

        nullable.insert("type".to_owned(), JsonValue::Array(types.to_vec()));

        if let Some(JsonValue::Array(values)) = schema.get("enum") {
            let mut widened = values.clone();

            widened.push(JsonValue::Null);
            nullable.insert("enum".to_owned(), JsonValue::Array(widened));
        }

        return nullable;
    }

    JsonObject::from_members([(
        "oneOf",
        JsonValue::Array(vec![
            JsonValue::Object(schema),
            JsonValue::Object(JsonObject::from_members([(
                "type",
                JsonValue::text(NULL_TYPE),
            )])),
        ]),
    )])
}

fn map_schema(
    _context: &mut EmitContext<'_>,
    _named: &seampact_ir::MapSchema,
    _variant: SchemaVariant,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("mapSchema"))
}

/// The `oneOf` of a union, with its discriminator: the tag's property and mapping, or its header.
fn union_schema(
    context: &mut EmitContext<'_>,
    named: &UnionSchema,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut schema = JsonObject::new();

    write_docs(&mut schema, Some(&named.docs));

    let Ok(tag) = KnownUnionTagRef::try_from(&named.tag) else {
        refuse_unknown(context, &location.below(&["tag", "in"]), named.tag.tag());

        return Ok(schema);
    };
    let mut branches = Vec::with_capacity(named.variants.len());

    for union_variant in &named.variants {
        let mut branch = match &tag {
            KnownUnionTagRef::Body(body) => body_tagged_branch(
                context,
                union_variant.schema.as_str(),
                &body.property,
                &union_variant.tag,
                variant,
            )?,
            KnownUnionTagRef::Header(_) => {
                schema_reference(context, union_variant.schema.as_str(), variant)
            }
        };
        let docs = union_variant.docs.as_ref();
        let description =
            docs.and_then(|docs| docs.description.as_deref().or(docs.summary.as_deref()));

        set_defined(&mut branch, "description", optional_text(description));
        branches.push(JsonValue::Object(branch));
    }

    schema.insert("oneOf".to_owned(), JsonValue::Array(branches));

    let body = match tag {
        KnownUnionTagRef::Header(header) => {
            let value = JsonObject::from_members([
                ("in", JsonValue::text("header")),
                ("name", JsonValue::text(&header.name)),
            ]);

            write_extension(
                context,
                &mut schema,
                ExtensionName::Discriminator,
                JsonValue::Object(value),
            );

            return Ok(schema);
        }
        KnownUnionTagRef::Body(body) => body,
    };

    // The mapping names each tag's shared variant, under strict input too: the variant's strict twin refuses the tag
    // member, which only the union's branch declares.
    let mut mapping = JsonObject::new();

    for union_variant in &named.variants {
        let reference = schema_reference(
            context,
            union_variant.schema.as_str(),
            SchemaVariant::Shared,
        );

        if let Some(JsonValue::String(target)) = reference.get("$ref") {
            mapping.insert(union_variant.tag.clone(), JsonValue::text(target));
        }
    }

    schema.insert(
        "discriminator".to_owned(),
        JsonValue::Object(JsonObject::from_members([
            ("propertyName", JsonValue::text(&body.property)),
            ("mapping", JsonValue::Object(mapping)),
        ])),
    );

    Ok(schema)
}

/// A branch of a body-tagged union: the variant and its tag.
fn body_tagged_branch(
    _context: &mut EmitContext<'_>,
    _schema_id: &str,
    _tag_property: &str,
    _tag_value: &str,
    _variant: SchemaVariant,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("bodyTaggedBranch"))
}

/// The JSON strings of a list of texts.
fn text_array(texts: &[String]) -> JsonValue {
    JsonValue::Array(texts.iter().map(|text| JsonValue::text(text)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(literal: &str) -> Result<Option<String>, OpenApiError> {
        Ok(number_literal(Some(literal))?.map(|value| match value {
            JsonValue::Number(number) => number.to_string(),
            other => format!("{other:?}"),
        }))
    }

    #[test]
    fn decimal_literals_keep_exact_integers_above_2_pow_53() -> Result<(), OpenApiError> {
        let cases = [
            ("9007199254740991", "9007199254740991"),
            ("9007199254740993", "9007199254740993"),
            ("-9007199254740993", "-9007199254740993"),
            ("0009007199254740993", "9007199254740993"),
            ("-0", "0"),
            ("0.1", "0.1"),
            ("1e21", "1e+21"),
            ("1e-17", "1e-17"),
        ];

        for (literal, expected) in cases {
            assert_eq!(
                written(literal)?.as_deref(),
                Some(expected),
                "literal {literal:?}"
            );
        }

        assert_eq!(number_literal(None)?, None);

        Ok(())
    }

    #[test]
    fn a_decimal_literal_that_is_no_finite_number_is_an_internal_error() {
        assert!(matches!(
            number_literal(Some("1e400")),
            Err(OpenApiError::Internal(_))
        ));
    }
}
