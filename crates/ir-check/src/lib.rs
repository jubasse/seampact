//! The IR JSON Schema validator and the shared conversion of a [`seampact_json::JsonValue`] for
//! validation.
//!
//! [`serde_value_through_f64`] writes every number from its `f64`, so `jsonschema` sees the value
//! Ajv saw. [`check_strict_ir`] and [`check_source_map`] hold a document to the strict form of the
//! IR schemas: every object closed, no unknown union tag or open-enum value.

mod check;
mod error;
mod serde_value;
mod strict_validators;

pub use check::{IrCheckFailure, check_source_map, check_strict_ir};
pub use error::IrCheckError;
pub use serde_value::serde_value_through_f64;
