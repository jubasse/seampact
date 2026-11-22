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
    let refusals = whole_diff_refusals(before, after);

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
}
