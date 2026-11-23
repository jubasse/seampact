//! Refusals located at an IR member: a form not generated yet, an unknown value, an inconsistent IR.

use crate::{IrLocation, NotGeneratedForm, Refusal, refuse_unknown_value, troubleshooting_url};

const INCONSISTENT_IR_FIX: &str =
    "Regenerate the IR with seampact: this document is not one it wrote.";

/// A form of the IR this target knows but does not generate yet (A47): the code names the form,
/// the message the operation, `member` the IR member; the fix and the docs section are the form's.
#[must_use]
pub fn refuse_not_generated_yet(
    form: NotGeneratedForm,
    description: &str,
    location: &IrLocation,
) -> Refusal {
    let in_operation = location
        .operation
        .as_ref()
        .map(|operation| format!(" in operation '{operation}'"))
        .unwrap_or_default();

    Refusal::new(
        format!("{}.unsupported", form.as_str()),
        format!("{description}{in_operation} is not generated yet."),
        form.fix(),
    )
    .with_operation(location.operation.clone())
    .with_member(&location.member)
    .with_docs(troubleshooting_url(form.section()))
}

/// An IR member this target must act on, holding an open-enum value it does not know (ADR 0005
/// section 3).
#[must_use]
pub fn refuse_unknown_value_at(location: &IrLocation, value: &str) -> Refusal {
    refuse_unknown_value(&location.member, value, location.operation.as_ref())
}

/// An IR that breaks a rule the compiler guarantees, such as a reference to a missing schema.
#[must_use]
pub fn refuse_inconsistent_ir(code: &str, description: &str, location: &IrLocation) -> Refusal {
    Refusal::new(
        code,
        format!("{description} {}.", location_text(location)),
        INCONSISTENT_IR_FIX,
    )
    .with_operation(location.operation.clone())
    .with_member(&location.member)
}

fn location_text(location: &IrLocation) -> String {
    let member = format!("at {}", location.member);

    match &location.operation {
        Some(operation) => format!("in operation '{operation}' {member}"),
        None => member,
    }
}

#[cfg(test)]
mod tests {
    use seampact_ir::OperationId;

    use super::*;

    #[test]
    fn a_refusal_names_the_operation_only_when_the_location_has_one() {
        let schema = IrLocation::schema_location("User");
        let operation = IrLocation::operation_location(0, OperationId::from_static("getUser"));

        assert_eq!(
            refuse_inconsistent_ir("ir.reference.missing", "A missing schema", &schema).message,
            "A missing schema at /schemas/User."
        );
        assert_eq!(
            refuse_inconsistent_ir("ir.reference.missing", "A missing schema", &operation).message,
            "A missing schema in operation 'getUser' at /operations/0."
        );
        assert_eq!(
            refuse_unknown_value_at(&operation, "x").message,
            "The value 'x' of /operations/0 in operation 'getUser' is not one this target knows."
        );
    }

    #[test]
    fn a_form_not_generated_yet_carries_its_code_fix_and_section() {
        let form = NotGeneratedForm::TypeNullable;

        let refusal =
            refuse_not_generated_yet(form, "A nullable value", &IrLocation::schema_location("A"));

        assert_eq!(refusal.code, "type.nullable.unsupported");
        assert_eq!(refusal.message, "A nullable value is not generated yet.");
        assert_eq!(refusal.fix, form.fix());
        assert_eq!(
            refusal.docs.as_deref(),
            Some("https://jubasse.github.io/seampact/troubleshooting/generate/#every-node-target")
        );
    }
}
