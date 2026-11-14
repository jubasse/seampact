//! The validate stage (ADR 0006 section 1): the raw tree checked against the authoring JSON
//! Schemas, refused schema keywords reported with ADR 0003's reasons.

mod ajv_error;
mod authoring_validators;
mod convert;
mod json_value;
mod keyword_problems;
mod marked;
mod pointer_text;
mod problem;
mod roles;
mod rules;
mod sentence;
mod suggest;
mod validate;

pub use json_value::{authored_value_of, serde_value_of};
pub use rules::{RULE_IDS, ValidateRule};
pub use suggest::closest_keyword;
pub use validate::{
    ApiDiagnostics, WorkspaceDiagnostics, validate_document, validate_layer, validate_workspace,
};
