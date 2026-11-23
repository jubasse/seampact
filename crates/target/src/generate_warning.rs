//! A form a target generates around but leaves to the developer's code.

use seampact_ir::OperationId;
use serde::{Deserialize, Serialize};

use crate::IrLocation;

/// Generation goes on; the warning names the form, where it is and what the developer's code does
/// instead (nothing is dropped silently).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerateWarning {
    /// The warning code, `<form>.handler`.
    pub code: String,
    /// What is left to the developer.
    pub message: String,
    /// What the developer's code does instead.
    pub fix: String,
    /// The operation the form belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<OperationId>,
    /// A JSON Pointer into the IR.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<String>,
}

/// A form the boundary leaves to the handler, or validates without enforcing.
#[must_use]
pub fn warn_left_to_handler(
    form: &str,
    description: &str,
    location: &IrLocation,
    fix: &str,
) -> GenerateWarning {
    let where_text = match &location.operation {
        None => format!("at {}", location.member),
        Some(operation) => format!(
            "in operation '{}' at {}",
            operation.as_str(),
            location.member
        ),
    };

    GenerateWarning {
        code: format!("{form}.handler"),
        message: format!("{description} {where_text} is not enforced by the generated boundary."),
        fix: fix.to_owned(),
        operation: location.operation.clone(),
        member: Some(location.member.clone()),
    }
}
