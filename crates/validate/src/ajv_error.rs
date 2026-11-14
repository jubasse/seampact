//! The failures of one validation as Ajv reports them: one per problem, with the parent schema.
//!
//! The converter reads the shape of an Ajv `ErrorObject`: its keyword and params, its instance
//! path and data, and the schema that holds the failing keyword. `jsonschema` reports the same
//! failures; this module flattens its contexts and adds what Ajv adds (one error per unexpected
//! property, the keyword's message). `jsonschema` emits no `if` error, which the conversion
//! ignores, and no inner `propertyNames` error, which it skips.

use jsonschema::error::ValidationErrorKind;
use jsonschema::{ValidationError, Validator};
use seampact_diagnostics::InternalError;
use seampact_js::FiniteNumber;
use seampact_json::JsonValue;
use serde_json::Value;

use crate::authoring_validators::AuthoringValidators;
use crate::json_value::authored_value_of;

/// What a failure is, with the params the converter reads.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AjvKind {
    /// `additionalProperties`: one unexpected property.
    AdditionalProperties { property: String },
    /// `propertyNames`: one key the name schema refuses.
    PropertyNames { property_name: String },
    /// `required`: one missing property.
    Required { missing_property: String },
    /// `type`: the expected types, as Ajv writes them, comma separated.
    Type { types: String },
    /// `maxProperties`.
    MaxProperties { limit: u64 },
    /// `const`.
    Const { allowed_value: JsonValue },
    /// `not`.
    Not,
    /// `enum`.
    Enum { allowed_values: Vec<JsonValue> },
    /// `pattern`.
    Pattern { pattern: String },
    /// Any other keyword: only Ajv's message is read.
    Other { message: String },
}

/// One failure, the shape of an Ajv `ErrorObject`.
#[derive(Debug, Clone)]
pub(crate) struct AjvError {
    pub kind: AjvKind,
    /// The JSON Pointer of the failing value.
    pub instance_path: String,
    /// The failing value.
    pub data: JsonValue,
    /// The schema object that holds the failing keyword.
    pub parent_schema: Option<&'static Value>,
    /// The value of the failing keyword (the name schema of `propertyNames`).
    pub schema: Option<&'static Value>,
}

/// Every failure of `instance` against `validator`, in Ajv's order.
///
/// # Errors
///
/// An [`InternalError`] for a keyword the authoring schemas do not use.
pub(crate) fn ajv_errors(
    validator: &Validator,
    instance: &Value,
    schemas: &'static AuthoringValidators,
) -> Result<Vec<AjvError>, InternalError> {
    let mut errors = Vec::new();

    for error in validator.iter_errors(instance) {
        push_error(&error, schemas, &mut errors)?;
    }

    Ok(errors)
}

// A failed `anyOf` or `oneOf` lists the errors of every branch, then its own.
fn push_error(
    error: &ValidationError<'_>,
    schemas: &'static AuthoringValidators,
    out: &mut Vec<AjvError>,
) -> Result<(), InternalError> {
    let contexts = match error.kind() {
        ValidationErrorKind::AnyOf { context } | ValidationErrorKind::OneOfNotValid { context } => {
            Some(context)
        }
        _ => None,
    };

    for branch in contexts.into_iter().flatten() {
        for inner in branch {
            push_error(inner, schemas, out)?;
        }
    }

    let data = authored_value_of(error.instance())?;
    let instance_path = error.instance_path().as_str().to_owned();
    let (parent_schema, schema) = schemas_of(error, schemas);
    let make = |kind: AjvKind| AjvError {
        kind,
        instance_path: instance_path.clone(),
        data: data.clone(),
        parent_schema,
        schema,
    };

    match error.kind() {
        ValidationErrorKind::AdditionalProperties { unexpected } => {
            for property in unexpected {
                out.push(make(AjvKind::AdditionalProperties {
                    property: property.clone(),
                }));
            }
        }
        ValidationErrorKind::PropertyNames { error: inner } => {
            let Value::String(name) = inner.instance().as_ref() else {
                return Err(InternalError::new("a property name that is not a string"));
            };

            out.push(make(AjvKind::PropertyNames {
                property_name: name.clone(),
            }));
        }
        ValidationErrorKind::AnyOf { .. }
        | ValidationErrorKind::OneOfNotValid { .. }
        | ValidationErrorKind::OneOfMultipleValid { .. } => out.push(make(AjvKind::Other {
            message: ajv_message(error)?,
        })),
        kind => out.push(make(plain_kind(kind, error)?)),
    }

    Ok(())
}

fn plain_kind(
    kind: &ValidationErrorKind,
    error: &ValidationError<'_>,
) -> Result<AjvKind, InternalError> {
    Ok(match kind {
        ValidationErrorKind::Required { property } => AjvKind::Required {
            missing_property: text_of(property)?,
        },
        ValidationErrorKind::Type { kind: types } => AjvKind::Type {
            types: type_names(types),
        },
        ValidationErrorKind::MaxProperties { limit } => AjvKind::MaxProperties { limit: *limit },
        ValidationErrorKind::Constant { expected_value } => AjvKind::Const {
            allowed_value: authored_value_of(expected_value)?,
        },
        ValidationErrorKind::Not { .. } => AjvKind::Not,
        ValidationErrorKind::Enum { options } => AjvKind::Enum {
            allowed_values: match options.as_ref() {
                Value::Array(values) => values
                    .iter()
                    .map(authored_value_of)
                    .collect::<Result<_, _>>()?,
                _ => return Err(InternalError::new("an enum that is not a list")),
            },
        },
        ValidationErrorKind::Pattern { pattern } => AjvKind::Pattern {
            pattern: pattern.clone(),
        },
        _ => AjvKind::Other {
            message: ajv_message(error)?,
        },
    })
}

fn text_of(value: &Value) -> Result<String, InternalError> {
    match value {
        Value::String(text) => Ok(text.clone()),
        other => Err(InternalError::new(format!(
            "a property name that is not a string: {other}"
        ))),
    }
}

fn type_names(kind: &jsonschema::error::TypeKind) -> String {
    match kind {
        jsonschema::error::TypeKind::Single(json_type) => json_type.to_string(),
        jsonschema::error::TypeKind::Multiple(types) => types
            .iter()
            .map(|json_type| json_type.to_string())
            .collect::<Vec<_>>()
            .join(","),
    }
}

// The schema object that holds the failing keyword, and the keyword's value, read from the
// embedded documents through the keyword's absolute location.
fn schemas_of(
    error: &ValidationError<'_>,
    schemas: &'static AuthoringValidators,
) -> (Option<&'static Value>, Option<&'static Value>) {
    let Some(location) = error.absolute_keyword_location() else {
        return (None, None);
    };
    let keyword_schema = schemas.schema_at(location);
    let parent_schema = schemas.parent_schema_at(location);

    (parent_schema, keyword_schema)
}

fn number_text(limit: &Value) -> Result<String, InternalError> {
    let number = limit
        .as_f64()
        .and_then(FiniteNumber::new)
        .ok_or_else(|| InternalError::new(format!("a limit that is not a number: {limit}")))?;

    Ok(number.to_string())
}

// Ajv's message for a keyword whose failure names schema facts only (a bound, a length).
fn ajv_message(error: &ValidationError<'_>) -> Result<String, InternalError> {
    let message = match error.kind() {
        ValidationErrorKind::MinLength { limit } => {
            format!("must NOT have fewer than {limit} characters")
        }
        ValidationErrorKind::MaxLength { limit } => {
            format!("must NOT have more than {limit} characters")
        }
        ValidationErrorKind::MinItems { limit } => {
            format!("must NOT have fewer than {limit} items")
        }
        ValidationErrorKind::MaxItems { limit } => format!("must NOT have more than {limit} items"),
        ValidationErrorKind::MinProperties { limit } => {
            format!("must NOT have fewer than {limit} properties")
        }
        ValidationErrorKind::Minimum { limit } => format!("must be >= {}", number_text(limit)?),
        ValidationErrorKind::Maximum { limit } => format!("must be <= {}", number_text(limit)?),
        ValidationErrorKind::ExclusiveMinimum { limit } => {
            format!("must be > {}", number_text(limit)?)
        }
        ValidationErrorKind::ExclusiveMaximum { limit } => {
            format!("must be < {}", number_text(limit)?)
        }
        ValidationErrorKind::Contains => "must contain at least 1 valid item(s)".to_owned(),
        ValidationErrorKind::UniqueItems => unique_items_message(error.instance())?,
        ValidationErrorKind::AnyOf { .. } => "must match a schema in anyOf".to_owned(),
        ValidationErrorKind::OneOfNotValid { .. }
        | ValidationErrorKind::OneOfMultipleValid { .. } => {
            "must match exactly one schema in oneOf".to_owned()
        }
        ValidationErrorKind::UnevaluatedProperties { .. } => {
            "must NOT have unevaluated properties".to_owned()
        }
        ValidationErrorKind::FalseSchema => "boolean schema is false".to_owned(),
        other => {
            return Err(InternalError::new(format!(
                "the authoring schemas use no keyword `{}` for which a message is written",
                other.keyword()
            )));
        }
    };

    Ok(message)
}

// Ajv scans from the last item down and names the first pair it finds equal.
fn unique_items_message(instance: &Value) -> Result<String, InternalError> {
    let Value::Array(items) = instance else {
        return Err(InternalError::new(
            "uniqueItems failed on a value that is not a list",
        ));
    };

    for later in (0..items.len()).rev() {
        for earlier in (0..later).rev() {
            if items.get(later) == items.get(earlier) {
                return Ok(format!(
                    "must NOT have duplicate items (items ## {earlier} and {later} are identical)"
                ));
            }
        }
    }

    Err(InternalError::new(
        "uniqueItems failed on a list of distinct items",
    ))
}
