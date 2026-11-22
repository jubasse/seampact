//! The diff of two contracts, or of two sets of contracts.

use indexmap::IndexMap;
use seampact_diff_table::{
    DiffComparison, DiffGateOutcome, DiffOptions, DiffPolicies, DiffResult, DiffSettings, DiffSide,
    resolve_diff_options,
};
use seampact_ir::{ContractIr, PackRef};
use seampact_js::cmp_utf16;

use crate::DiffError;
use crate::deprecation::deprecation_report;
use crate::gate::{applied_policy, apply_gate};
use crate::walk_contracts::walk_contracts;
use crate::walk_refusals::whole_diff_refusals;

/// The changes from `before` to `after` of one api, the gate and the deprecations.
///
/// # Errors
///
/// [`DiffError::Options`] when `options` hold a date that is not a calendar date.
pub fn diff_contracts(
    before: &ContractIr,
    after: &ContractIr,
    options: &DiffOptions,
) -> Result<DiffResult, DiffError> {
    let resolved = resolve_diff_options(options)?;
    let refusals = whole_diff_refusals(before, after)?;

    if !refusals.is_empty() {
        return Ok(DiffResult::Refused(refusals));
    }

    let mut walk = walk_contracts(before, after)?;

    if !walk.refusals.is_empty() {
        return Ok(DiffResult::Refused(walk.refusals));
    }

    let failures = apply_gate(&mut walk.changes, before, after, &resolved);
    let deprecations = deprecation_report(before, after, &resolved.today)?;
    let before_policy = before.api.compat.policy.clone();
    let after_policy = after.api.compat.policy.clone();

    Ok(DiffResult::Compared(Box::new(DiffComparison {
        api: after.api.id.clone(),
        before: side_of(before),
        after: side_of(after),
        policy: DiffPolicies {
            applied: applied_policy(&before_policy, &after_policy),
            before: before_policy,
            after: after_policy,
        },
        settings: DiffSettings {
            gate: resolved.gate,
            exempt: resolved.exempt,
        },
        changes: walk.changes,
        gate: DiffGateOutcome {
            passed: failures.is_empty(),
            failures,
        },
        deprecations,
    })))
}

/// The diff of each api of two sets, keyed and ordered by api name.
///
/// An api only in `before` has every operation removed, one only in `after` every operation added.
///
/// # Errors
///
/// What [`diff_contracts`] answers for one of the apis.
pub fn diff_contract_sets(
    before: &IndexMap<String, ContractIr>,
    after: &IndexMap<String, ContractIr>,
    options: &DiffOptions,
) -> Result<IndexMap<String, DiffResult>, DiffError> {
    let mut names: Vec<&String> = before.keys().chain(after.keys()).collect();

    names.sort_by(|left, right| cmp_utf16(left, right));
    names.dedup();

    let mut results = IndexMap::new();

    for name in names {
        let result = match (before.get(name), after.get(name)) {
            (Some(before_ir), Some(after_ir)) => diff_contracts(before_ir, after_ir, options)?,
            (Some(before_ir), None) => {
                diff_contracts(before_ir, &without_operations(before_ir), options)?
            }
            (None, Some(after_ir)) => {
                diff_contracts(&without_operations(after_ir), after_ir, options)?
            }
            (None, None) => continue,
        };

        results.insert(name.clone(), result);
    }

    Ok(results)
}

/// The contract with no operation: the baseline of an api that only one side has.
fn without_operations(ir: &ContractIr) -> ContractIr {
    ContractIr {
        operations: Vec::new(),
        ..ir.clone()
    }
}

fn side_of(ir: &ContractIr) -> DiffSide {
    DiffSide {
        version: ir.api.version.clone(),
        ir_revision: ir.ir_revision,
        packs: ir
            .packs
            .iter()
            .map(|pack| PackRef {
                name: pack.name.clone(),
                version: pack.version.clone(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use seampact_diff_table::{DiffBreak, DiffClassification, DiffCode, DiffKind};
    use seampact_ir::{CompatPolicy, Schema};

    use super::*;
    use crate::sample_ir::sample_ir;

    fn options(today: &str) -> DiffOptions {
        DiffOptions {
            today: today.to_owned(),
            gate: None,
            exempt: None,
        }
    }

    #[test]
    fn a_today_that_is_no_calendar_date_is_refused() {
        let ir = sample_ir();
        let result = diff_contracts(&ir, &ir, &options("2026-02-30"));

        assert!(
            matches!(result, Err(DiffError::Options(_))),
            "got {result:?}"
        );
    }

    #[test]
    fn contracts_of_two_ir_versions_are_refused_before_the_walk() {
        let before = sample_ir();
        let mut after = before.clone();

        after.ir_version += 1;

        let result = diff_contracts(&before, &after, &options("2026-01-01"));
        let codes: Option<Vec<DiffCode>> = match result {
            Ok(DiffResult::Refused(refusals)) => {
                Some(refusals.iter().map(|refusal| refusal.code).collect())
            }
            _ => None,
        };

        assert_eq!(codes, Some(vec![DiffCode::IrVersionDiffers]));
    }

    fn remove_last_mixed_property(ir: &mut ContractIr) {
        if let Some(Schema::Object(object)) = ir.schemas.get_mut("Mixed") {
            object.properties.pop();
        }
    }

    fn compared(result: DiffResult) -> DiffComparison {
        match result {
            DiffResult::Compared(comparison) => *comparison,
            DiffResult::Refused(refusals) => panic!("refused: {refusals:?}"),
        }
    }

    #[test]
    fn additive_only_fails_a_removed_property_naming_clients_and_the_operation() {
        let mut before = sample_ir();

        before.api.compat.policy = CompatPolicy::AdditiveOnly;

        let mut after = before.clone();

        remove_last_mixed_property(&mut after);

        let comparison = compared(diff_contracts(&before, &after, &options("2026-01-01")).unwrap());
        let failure = comparison.gate.failures.first();

        assert!(!comparison.gate.passed);
        assert_eq!(
            failure.map(|found| (found.code, found.kind, found.breaks.clone())),
            Some((
                DiffCode::PolicyBreaking,
                DiffKind::PropertyRemoved,
                vec![DiffBreak::Clients]
            ))
        );
        assert!(failure.is_some_and(|found| found.operations.iter().any(|id| id == "mixed")));
    }

    #[test]
    fn policy_none_reports_and_passes() {
        let before = sample_ir();
        let mut after = before.clone();

        remove_last_mixed_property(&mut after);

        let comparison = compared(diff_contracts(&before, &after, &options("2026-01-01")).unwrap());

        assert!(comparison.gate.passed);
        assert_eq!(comparison.gate.failures, Vec::new());
        assert!(
            comparison
                .changes
                .iter()
                .all(|change| change.kind == DiffKind::PropertyRemoved)
        );
        assert_ne!(comparison.changes.len(), 0);
    }

    #[test]
    fn reordering_properties_is_only_informative() {
        let before = sample_ir();
        let mut after = before.clone();

        if let Some(Schema::Object(object)) = after.schemas.get_mut("Mixed") {
            object.properties.reverse();
        }

        let comparison = compared(diff_contracts(&before, &after, &options("2026-01-01")).unwrap());

        assert_ne!(comparison.changes.len(), 0);
        assert!(comparison.changes.iter().all(|change| {
            change.kind == DiffKind::Order
                && change.classification == DiffClassification::Informative
        }));
    }

    #[test]
    fn a_set_is_diffed_by_api_name_in_utf16_order_and_a_lone_api_against_no_operations() {
        let ir = sample_ir();
        let before: IndexMap<String, ContractIr> = IndexMap::from([("b".to_owned(), ir.clone())]);
        let after: IndexMap<String, ContractIr> = IndexMap::from([
            ("\u{FF5E}".to_owned(), ir.clone()),
            ("\u{10000}".to_owned(), ir.clone()),
            ("b".to_owned(), ir),
        ]);
        let results = diff_contract_sets(&before, &after, &options("2026-01-01")).unwrap();
        let names: Vec<&str> = results.keys().map(String::as_str).collect();

        assert_eq!(names, vec!["b", "\u{10000}", "\u{FF5E}"]);

        let added: Vec<DiffKind> = match results.get("\u{FF5E}") {
            Some(DiffResult::Compared(comparison)) => comparison
                .changes
                .iter()
                .map(|change| change.kind)
                .collect(),
            other => panic!("{other:?}"),
        };

        assert_eq!(
            added,
            vec![DiffKind::OperationAdded, DiffKind::OperationAdded]
        );
    }
}
