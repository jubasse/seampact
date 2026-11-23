//! The IR support check of a target, worded with the target to update.

use seampact_ir::{ContractIr, IrSupportCode, IrSupportMismatch, IrSupportValue, check_contract_ir_support};

use crate::{Refusal, TargetMetadata};

/// One refusal per mismatch of the IR support check, naming beyond it the target and version to
/// update with the IR's value and the expected one (ADR 0005 section 2).
#[must_use]
pub fn refuse_unsupported_ir(ir: &ContractIr, metadata: &TargetMetadata) -> Vec<Refusal> {
    check_contract_ir_support(ir, &metadata.ir_support)
        .into_iter()
        .map(|mismatch| refusal_of(mismatch, metadata))
        .collect()
}

fn refusal_of(mismatch: IrSupportMismatch, metadata: &TargetMetadata) -> Refusal {
    let target = format!("{} {}", metadata.id.as_str(), metadata.version);
    let expected = if mismatch.expected.is_empty() {
        "none".to_owned()
    } else {
        let texts: Vec<String> = mismatch.expected.iter().map(support_text).collect();

        texts.join(", ")
    };

    Refusal {
        code: mismatch.code.as_str().to_owned(),
        message: format!(
            "{} The IR has {}; {target} expects {expected}.",
            mismatch.message,
            support_text(&mismatch.value)
        ),
        fix: fix_of(&mismatch, metadata.id.as_str()),
        operation: mismatch.operation,
        member: Some(mismatch.member),
        docs: None,
    }
}

fn fix_of(mismatch: &IrSupportMismatch, target: &str) -> String {
    match mismatch.code {
        IrSupportCode::VersionUnsupported | IrSupportCode::RevisionMismatch => format!(
            "Update {target} to the release built for the IR this seampact version writes, or use the seampact version {target} was built with."
        ),
        IrSupportCode::KindUnsupported | IrSupportCode::FeatureUnsupported => format!(
            "Update {target} to a release that supports '{}', or remove its use from the contract.",
            support_text(&mismatch.value)
        ),
        IrSupportCode::SupportMalformed => {
            "Regenerate the IR with seampact: this document is not one it wrote.".to_owned()
        }
    }
}

fn support_text(value: &IrSupportValue) -> String {
    match value {
        IrSupportValue::Text(text) => text.clone(),
        IrSupportValue::Number(number) => number.to_string(),
    }
}
