//! The failures of a config schema as Ajv reports them: the keyword, the path and the message.

use jsonschema::error::{TypeKind, ValidationErrorKind};
use jsonschema::{ValidationError, Validator};
use seampact_validate::ajv_message;
use serde_json::Value;

use crate::schema_order::in_ajv_order;

/// The keyword of a failure, with the params the problems read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SchemaKeyword {
    /// `additionalProperties`: the unexpected property.
    AdditionalProperties(String),
    /// `required`: the missing property.
    Required(String),
    /// `pattern`.
    Pattern,
    /// `oneOf`: no branch, or more than one, matched.
    OneOf,
    /// Any other keyword, named as Ajv names it.
    Other(String),
}

impl SchemaKeyword {
    pub(crate) fn is_one_of(&self) -> bool {
        matches!(self, Self::OneOf)
    }
}

/// One failure, the shape of an Ajv `ErrorObject` as the problems read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SchemaFailure {
    pub(crate) keyword: SchemaKeyword,
    /// The JSON Pointer of the failing value.
    pub(crate) instance_path: String,
    /// Whether the failing keyword sits in a branch of a `oneOf`.
    pub(crate) in_one_of_branch: bool,
    /// The JSON Pointer of the failing keyword in the schema, `$ref` followed.
    pub(crate) schema_path: String,
    /// Ajv's message, which follows `The value `.
    pub(crate) message: String,
}

/// Every failure of `instance` against `validator`, in the order Ajv reports them: a branch's failures, then the `oneOf` that holds them.
pub(crate) fn schema_failures(validator: &Validator, instance: &Value) -> Vec<SchemaFailure> {
    let mut failures = Vec::new();

    for error in validator.iter_errors(instance) {
        push_failures(&error, false, &mut failures);
    }

    in_ajv_order(failures)
}

fn push_failures(
    error: &ValidationError<'_>,
    in_one_of_branch: bool,
    failures: &mut Vec<SchemaFailure>,
) {
    let instance_path = error.instance_path().as_str().to_owned();
    let schema_path = error.schema_path().as_str().to_owned();
    let make = |keyword: SchemaKeyword, message: String| SchemaFailure {
        keyword,
        instance_path: instance_path.clone(),
        in_one_of_branch,
        schema_path: schema_path.clone(),
        message,
    };

    match error.kind() {
        ValidationErrorKind::OneOfNotValid { context }
        | ValidationErrorKind::OneOfMultipleValid { context } => {
            for branch in context {
                for inner in branch {
                    push_failures(inner, true, failures);
                }
            }

            failures.push(make(
                SchemaKeyword::OneOf,
                "must match exactly one schema in oneOf".to_owned(),
            ));
        }
        ValidationErrorKind::AnyOf { context } => {
            for branch in context {
                for inner in branch {
                    push_failures(inner, in_one_of_branch, failures);
                }
            }

            failures.push(make(
                SchemaKeyword::Other("anyOf".to_owned()),
                "must match a schema in anyOf".to_owned(),
            ));
        }
        ValidationErrorKind::AdditionalProperties { unexpected } => {
            for property in unexpected {
                failures.push(make(
                    SchemaKeyword::AdditionalProperties(property.clone()),
                    "must NOT have additional properties".to_owned(),
                ));
            }
        }
        ValidationErrorKind::PropertyNames { error: inner } => {
            if let ValidationErrorKind::Pattern { pattern } = inner.kind() {
                failures.push(make(SchemaKeyword::Pattern, pattern_message(pattern)));
            }

            failures.push(make(
                SchemaKeyword::Other("propertyNames".to_owned()),
                "property name must be valid".to_owned(),
            ));
        }
        ValidationErrorKind::Required { property } => {
            let missing = match property {
                Value::String(name) => name.clone(),
                other => other.to_string(),
            };

            failures.push(make(
                SchemaKeyword::Required(missing.clone()),
                format!("must have required property '{missing}'"),
            ));
        }
        ValidationErrorKind::Pattern { pattern } => {
            failures.push(make(SchemaKeyword::Pattern, pattern_message(pattern)));
        }
        kind => failures.push(make(
            SchemaKeyword::Other(keyword_name(kind)),
            other_message(kind, error),
        )),
    }
}

fn pattern_message(pattern: &str) -> String {
    format!("must match pattern \"{pattern}\"")
}

fn keyword_name(kind: &ValidationErrorKind) -> String {
    match kind {
        ValidationErrorKind::Type { .. } => "type",
        ValidationErrorKind::Enum { .. } => "enum",
        ValidationErrorKind::Constant { .. } => "const",
        ValidationErrorKind::MinLength { .. } => "minLength",
        ValidationErrorKind::MinItems { .. } => "minItems",
        ValidationErrorKind::MaxProperties { .. } => "maxProperties",
        ValidationErrorKind::MinProperties { .. } => "minProperties",
        ValidationErrorKind::Not { .. } => "not",
        _ => "schema",
    }
    .to_owned()
}

fn other_message(kind: &ValidationErrorKind, error: &ValidationError<'_>) -> String {
    match kind {
        ValidationErrorKind::Type { kind: types } => format!("must be {}", type_names(types)),
        ValidationErrorKind::Enum { .. } => "must be equal to one of the allowed values".to_owned(),
        ValidationErrorKind::Constant { .. } => "must be equal to constant".to_owned(),
        ValidationErrorKind::Not { .. } => "must NOT be valid".to_owned(),
        _ => ajv_message(error).unwrap_or_else(|_| error.to_string()),
    }
}

fn type_names(types: &TypeKind) -> String {
    match types {
        TypeKind::Single(json_type) => json_type.to_string(),
        TypeKind::Multiple(set) => set
            .iter()
            .map(|json_type| json_type.to_string())
            .collect::<Vec<_>>()
            .join(","),
    }
}
