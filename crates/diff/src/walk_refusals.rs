//! The refusals of the whole diff: two IR formats, two apis, two api versions, or a value the gate
//! must act on that this diff does not know.

use seampact_diff_table::{DiffCode, DiffRefusal, DiffValue};
use seampact_ir::{ApiVersion, CompatPolicy, ContractIr};
use seampact_json::{JsonNumber, stringify_json};

use crate::walk_context::unknown_value_refusal;
use crate::walk_json::is_same_json;
use crate::walk_maturity::is_known_maturity;

/// The refusals that stop a diff before the walk, in the order the report prints them.
pub(crate) fn whole_diff_refusals(before: &ContractIr, after: &ContractIr) -> Vec<DiffRefusal> {
    let mut refusals = Vec::new();

    if before.ir_version != after.ir_version {
        refusals.push(refusal(
            DiffCode::IrVersionDiffers,
            format!(
                "The baseline IR has irVersion {} and the new one {}; a diff compares one irVersion.",
                before.ir_version, after.ir_version
            ),
            "Recompile the older contract with this compiler, then diff again.",
            DiffValue::Number(JsonNumber::from_i64(before.ir_version)),
            DiffValue::Number(JsonNumber::from_i64(after.ir_version)),
        ));
    } else if before.ir_revision != after.ir_revision {
        refusals.push(refusal(
            DiffCode::IrRevisionDiffers,
            format!(
                "The baseline IR has irRevision {} and the new one {}; before 1.0 a diff compares one revision.",
                before.ir_revision, after.ir_revision
            ),
            "Rebuild the baseline with this compiler (a bundle carries its sources), then diff again.",
            DiffValue::Number(JsonNumber::from_i64(before.ir_revision)),
            DiffValue::Number(JsonNumber::from_i64(after.ir_revision)),
        ));
    }

    if before.api.id != after.api.id {
        refusals.push(refusal(
            DiffCode::ApiNameDiffers,
            format!(
                "The baseline is the api {} and the new IR the api {}.",
                before.api.id, after.api.id
            ),
            "Diff each api against a baseline of the same api.",
            DiffValue::Text(before.api.id.clone()),
            DiffValue::Text(after.api.id.clone()),
        ));
    } else if !is_same_api_version(&before.api.version, &after.api.version) {
        let before_text = api_version_text(&before.api.version);
        let after_text = api_version_text(&after.api.version);

        refusals.push(refusal(
            DiffCode::ApiVersionDiffers,
            format!(
                "The api {} moves from version {before_text} to {after_text}; a new path version is a new api.",
                after.api.id
            ),
            "Diff the new version against a baseline of the same version; the old version keeps its own.",
            DiffValue::Text(before_text),
            DiffValue::Text(after_text),
        ));
    }

    refusals.extend(gate_value_refusals(before));
    refusals.extend(gate_value_refusals(after));

    refusals
}

fn refusal(
    code: DiffCode,
    message: String,
    fix: &str,
    before: DiffValue,
    after: DiffValue,
) -> DiffRefusal {
    DiffRefusal {
        code,
        message,
        fix: fix.to_owned(),
        before: Some(before),
        after: Some(after),
        member: None,
        operations: None,
    }
}

/// Two api versions are the same when their JSON is; a known version compares by its members.
fn is_same_api_version(before: &ApiVersion, after: &ApiVersion) -> bool {
    match (before, after) {
        (ApiVersion::Unknown(left), ApiVersion::Unknown(right)) => {
            is_same_json(Some(left.raw()), Some(right.raw()))
        }
        _ => before == after,
    }
}

/// The version as the report writes it: `v<number>` for a path version, else the label.
pub(crate) fn api_version_text(version: &ApiVersion) -> String {
    match version {
        ApiVersion::Path(path) => format!("v{}", path.number),
        ApiVersion::Label(label) => label.label.clone(),
        ApiVersion::Unknown(unknown) => stringify_json(unknown.raw()),
    }
}

fn gate_value_refusals(ir: &ContractIr) -> Vec<DiffRefusal> {
    let mut refusals = Vec::new();

    if let CompatPolicy::Unknown(policy) = &ir.api.compat.policy {
        refusals.push(unknown_value_refusal(
            "/api/compat/policy",
            policy.as_str(),
            &[],
        ));
    }

    if !is_known_maturity(&ir.api.maturity) {
        refusals.push(unknown_value_refusal(
            "/api/maturity",
            ir.api.maturity.as_str(),
            &[],
        ));
    }

    for (position, operation) in ir.operations.iter().enumerate() {
        if !is_known_maturity(&operation.maturity.level) {
            refusals.push(unknown_value_refusal(
                &format!("/operations/{position}/maturity/level"),
                operation.maturity.level.as_str(),
                &[operation.id.as_str().to_owned()],
            ));
        }
    }

    refusals
}

#[cfg(test)]
mod tests {
    use seampact_ir::LabelApiVersion;

    use super::*;
    use crate::sample_ir::sample_ir;

    #[test]
    fn two_contracts_of_one_api_and_version_have_no_whole_diff_refusal() {
        let ir = sample_ir();

        assert_eq!(whole_diff_refusals(&ir, &ir), Vec::new());
    }

    #[test]
    fn a_different_ir_version_is_refused_alone_and_names_both() {
        let before = sample_ir();
        let mut after = before.clone();

        after.ir_version += 1;
        after.ir_revision += 1;

        let refusals = whole_diff_refusals(&before, &after);
        let codes: Vec<DiffCode> = refusals.iter().map(|refusal| refusal.code).collect();

        assert_eq!(codes, vec![DiffCode::IrVersionDiffers]);
        assert_eq!(
            refusals.first().map(|refusal| refusal.message.as_str()),
            Some(
                "The baseline IR has irVersion 1 and the new one 2; a diff compares one irVersion."
            )
        );
    }

    #[test]
    fn another_api_version_is_refused_with_both_texts() {
        let before = sample_ir();
        let mut after = before.clone();

        after.api.version = ApiVersion::Label(LabelApiVersion {
            label: "beta".to_owned(),
        });

        let refusals = whole_diff_refusals(&before, &after);

        assert_eq!(
            refusals
                .first()
                .map(|refusal| (refusal.code, refusal.after.clone())),
            Some((
                DiffCode::ApiVersionDiffers,
                Some(DiffValue::Text("beta".to_owned()))
            ))
        );
        assert_eq!(api_version_text(&before.api.version), "v1");
    }
}
