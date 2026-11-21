//! The JSON Schemas of type uses and named schemas.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, Docs, KnownSchemaRef, KnownTypeUseRef, Refinements, TypeUse, UnknownKeysPolicy,
};
use seampact_js::js_number_of_text;
use seampact_json::{JsonNumber, JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::{EmitContext, SchemaVariant, refuse_unknown};
use crate::json_value::{optional_integer, optional_text, set_defined, text_value};
use crate::not_ported::not_ported_yet;

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
    let policy = match use_ {
        TypeUse::Ref(reference) => reference.unknown_keys.as_ref().map(|keys| &keys.policy),
        _ => None,
    };

    policy.is_none_or(|policy| *policy == UnknownKeysPolicy::Refuse)
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
///
/// # Errors
///
/// As [`number_literal`].
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
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while an item is written by a stub.
fn array_schema(
    context: &mut EmitContext<'_>,
    use_: &ArrayTypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let items = type_use_schema(context, &use_.items, variant, &location.below(&["items"]))?;
    let mut schema = JsonObject::new();

    schema.insert("type".to_owned(), text_value("array"));
    schema.insert("items".to_owned(), JsonValue::Object(items));
    set_defined(&mut schema, "minItems", optional_integer(use_.min_items));
    set_defined(&mut schema, "maxItems", optional_integer(use_.max_items));

    Ok(schema)
}

/// The schema of a type use, with its docs and examples, nullable when the use says so.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a form is written by a stub.
pub(crate) fn type_use_schema(
    context: &mut EmitContext<'_>,
    use_: &TypeUse,
    variant: SchemaVariant,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let Ok(known) = KnownTypeUseRef::try_from(use_) else {
        refuse_unknown(context, &location.below(&["kind"]), use_.tag())?;

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
        return nullable_schema(schema);
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
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the kinds are ported.
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

fn known_use_schema(
    _context: &mut EmitContext<'_>,
    _use: &KnownTypeUseRef<'_>,
    _variant: SchemaVariant,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("knownUseSchema"))
}

fn wire_value(
    _context: &EmitContext<'_>,
    _use: &TypeUse,
    _value: &JsonValue,
) -> Result<JsonValue, OpenApiError> {
    Err(not_ported_yet("wireValue"))
}

fn nullable_schema(_schema: JsonObject) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("nullableSchema"))
}

fn object_schema(
    _context: &mut EmitContext<'_>,
    _named: &seampact_ir::ObjectSchema,
    _variant: SchemaVariant,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("objectSchema"))
}

fn map_schema(
    _context: &mut EmitContext<'_>,
    _named: &seampact_ir::MapSchema,
    _variant: SchemaVariant,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("mapSchema"))
}

fn union_schema(
    _context: &mut EmitContext<'_>,
    _named: &seampact_ir::UnionSchema,
    _variant: SchemaVariant,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("unionSchema"))
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

    #[test]
    fn a_reference_refuses_unknown_keys_unless_its_policy_says_otherwise()
    -> Result<(), Box<dyn std::error::Error>> {
        let refusing: TypeUse = serde_json::from_str(r#"{"kind":"ref","schema":"A"}"#)?;
        let keeping: TypeUse =
            serde_json::from_str(r#"{"kind":"ref","schema":"A","unknownKeys":{"policy":"keep"}}"#)?;
        let unknown: TypeUse = serde_json::from_str(r#"{"kind":"tuple"}"#)?;

        assert!(refuses_unknown_keys(&refusing));
        assert!(!refuses_unknown_keys(&keeping));
        assert!(refuses_unknown_keys(&unknown));

        Ok(())
    }

    #[test]
    fn docs_write_title_and_description_only_when_present() {
        let mut schema = JsonObject::new();

        write_docs(&mut schema, None);
        assert!(schema.is_empty());

        let docs = Docs {
            summary: Some("A task".to_owned()),
            description: None,
        };

        write_docs(&mut schema, Some(&docs));
        assert_eq!(schema.get("title"), Some(&text_value("A task")));
        assert!(!schema.contains_key("description"));
    }
}
