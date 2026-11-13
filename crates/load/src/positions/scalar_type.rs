//! The YAML type of a resolved scalar, the vocabulary of a position's types.

use seampact_json::JsonValue;

use super::types::TypeName;

/// The type of a scalar a mapping holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalarType {
    /// A string.
    String,
    /// A number that is no whole number.
    Number,
    /// A whole number.
    Integer,
    /// `true` or `false`.
    Boolean,
    /// `null`.
    Null,
}

impl ScalarType {
    /// The schema type the scalar type stands for.
    pub(super) fn type_name(self) -> TypeName {
        match self {
            Self::String => TypeName::String,
            Self::Number => TypeName::Number,
            Self::Integer => TypeName::Integer,
            Self::Boolean => TypeName::Boolean,
            Self::Null => TypeName::Null,
        }
    }
}

/// The type of a resolved scalar, `None` for a mapping or a list (`scalarType`).
#[must_use]
pub fn scalar_type(value: &JsonValue) -> Option<ScalarType> {
    match value {
        JsonValue::Null => Some(ScalarType::Null),
        JsonValue::String(_) => Some(ScalarType::String),
        JsonValue::Bool(_) => Some(ScalarType::Boolean),
        JsonValue::Number(number) if number.is_integer() => Some(ScalarType::Integer),
        JsonValue::Number(_) => Some(ScalarType::Number),
        JsonValue::Array(_) | JsonValue::Object(_) => None,
    }
}
