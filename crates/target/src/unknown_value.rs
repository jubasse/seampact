//! The refusal of an open-enum value a target does not know (ADR 0005 section 3 item 2).

use seampact_ir::OperationId;

use crate::Refusal;

const UNKNOWN_VALUE_CODE: &str = "ir.value.unknown";

const UNKNOWN_VALUE_FIX: &str = "Update the target to a release that supports this value, or change the contract so it is not used.";

/// The refusal a target returns when it must act on an open-enum value it does not know: it names
/// the value, the member and the operation, and never guesses or skips.
#[must_use]
pub fn refuse_unknown_value(member: &str, value: &str, operation: Option<&OperationId>) -> Refusal {
    let in_operation = operation
        .map(|operation| format!(" in operation '{operation}'"))
        .unwrap_or_default();

    Refusal {
        code: UNKNOWN_VALUE_CODE.to_owned(),
        message: format!(
            "The value '{value}' of {member}{in_operation} is not one this target knows."
        ),
        fix: UNKNOWN_VALUE_FIX.to_owned(),
        operation: operation.cloned(),
        member: Some(member.to_owned()),
        docs: None,
    }
}
