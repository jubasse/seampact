//! The release gate: under `additive-only` every change breaking a gated side fails, unless an
//! exemption covers it; under `none` the changes are reported and the gate passes.

use std::cmp::Ordering;

use seampact_diff_table::{
    DiffBreak, DiffChange, DiffCode, DiffExemption, DiffGateScope, DiffKind, GateFailure,
    GateMaturity, ResolvedDiffOptions,
};
use seampact_ir::{CompatPolicy, ContractIr, Maturity, MaturitySource, Operation};
use seampact_js::cmp_utf16;

/// The fix of a `diff.policy.breaking` failure.
const POLICY_FIX: &str = "Make the change additive (keep the old member beside the new one), or publish it as a new api version; a release that breaks on purpose sets compat: { policy: none } in both versions.";

/// The fix of a `diff.maturity.stable` failure.
const STABLE_FIX: &str = "A stable operation takes additive changes only: revert the change, or add a successor operation and deprecate this one.";

/// The stricter of the two policies: relaxing and breaking in one release would escape the gate.
pub(crate) fn applied_policy(before: &CompatPolicy, after: &CompatPolicy) -> CompatPolicy {
    if *before == CompatPolicy::AdditiveOnly || *after == CompatPolicy::AdditiveOnly {
        CompatPolicy::AdditiveOnly
    } else {
        CompatPolicy::None
    }
}

/// The failures of `changes` under the gate, setting `exemption` on each change an exemption covers.
///
pub(crate) fn apply_gate(
    changes: &mut [DiffChange],
    before: &ContractIr,
    after: &ContractIr,
    options: &ResolvedDiffOptions,
) -> Vec<GateFailure> {
    let applied = applied_policy(&before.api.compat.policy, &after.api.compat.policy);

    if applied != CompatPolicy::AdditiveOnly {
        return Vec::new();
    }

    let mut failures = Vec::new();

    for change in changes {
        let is_gated = change
            .breaks
            .iter()
            .any(|side| options.gate == DiffGateScope::Both || *side == DiffBreak::Clients);

        if !is_gated {
            continue;
        }

        if let Some(exemption) = exemption_of(change, before, options) {
            change.exemption = Some(exemption);

            continue;
        }

        failures.push(policy_failure(change));
        failures.extend(stable_failures(change, before, after));
    }

    failures
}

/// The exemption that covers `change`, if one does.
fn exemption_of(
    change: &DiffChange,
    before: &ContractIr,
    options: &ResolvedDiffOptions,
) -> Option<DiffExemption> {
    if options.exempt.contains(&DiffExemption::SunsetPassed)
        && is_removal_past_sunset(change, before, &options.today)
    {
        return Some(DiffExemption::SunsetPassed);
    }

    if options.exempt.contains(&DiffExemption::Experimental) && is_on_experimental(change, before) {
        return Some(DiffExemption::Experimental);
    }

    None
}

/// A removal whose operation sunset on or before `today` (ISO dates compare as text).
fn is_removal_past_sunset(change: &DiffChange, before: &ContractIr, today: &str) -> bool {
    if change.kind != DiffKind::OperationRemoved {
        return false;
    }

    let sunset = before_operation(before, change.operations.first().map(String::as_str))
        .and_then(|operation| operation.deprecated.as_ref())
        .map(|deprecation| deprecation.sunset.as_str());

    sunset.is_some_and(|date| cmp_utf16(date, today) != Ordering::Greater)
}

/// A change only on experimental operations, or on an experimental api when it reaches none.
fn is_on_experimental(change: &DiffChange, before: &ContractIr) -> bool {
    if change.operations.is_empty() {
        return before.api.maturity == Maturity::Experimental;
    }

    change.operations.iter().all(|id| {
        before_operation(before, Some(id))
            .is_some_and(|operation| operation.maturity.level == Maturity::Experimental)
    })
}

fn before_operation<'ir>(before: &'ir ContractIr, id: Option<&str>) -> Option<&'ir Operation> {
    let id = id?;

    before
        .operations
        .iter()
        .find(|operation| operation.id.as_str() == id)
}

/// The `diff.policy.breaking` failure of `change`.
fn policy_failure(change: &DiffChange) -> GateFailure {
    let on = if change.operations.is_empty() {
        String::new()
    } else {
        format!(" on {}", change.operations.join(", "))
    };
    let message = format!(
        "{} breaks {}{on}, and compat.policy is additive-only.",
        change_text(change),
        breaks_text(&change.breaks)
    );

    failure_base(change, DiffCode::PolicyBreaking, message, POLICY_FIX, None)
}

/// The `diff.maturity.stable` failures of `change`: the api when it reaches no operation, else each
/// operation that is stable before or after.
fn stable_failures(
    change: &DiffChange,
    before: &ContractIr,
    after: &ContractIr,
) -> Vec<GateFailure> {
    if change.operations.is_empty() {
        if before.api.maturity != Maturity::Stable && after.api.maturity != Maturity::Stable {
            return Vec::new();
        }

        return vec![stable_failure(change, None, MaturitySource::Api)];
    }

    change
        .operations
        .iter()
        .filter_map(|id| {
            let stable = [before, after]
                .into_iter()
                .filter_map(|side| before_operation(side, Some(id)))
                .map(|operation| &operation.maturity)
                .find(|maturity| maturity.level == Maturity::Stable)?;

            Some(stable_failure(change, Some(id), stable.source.clone()))
        })
        .collect()
}

fn stable_failure(
    change: &DiffChange,
    operation: Option<&str>,
    source: MaturitySource,
) -> GateFailure {
    let subject = operation.unwrap_or("The api");
    let message = format!(
        "{subject} is stable (from {source}) and {} breaks {}.",
        change_text(change),
        breaks_text(&change.breaks)
    );
    let maturity = GateMaturity {
        operation: operation.map(str::to_owned),
        level: Maturity::Stable.as_str().to_owned(),
        source,
    };

    failure_base(
        change,
        DiffCode::MaturityStable,
        message,
        STABLE_FIX,
        Some(maturity),
    )
}

fn failure_base(
    change: &DiffChange,
    code: DiffCode,
    message: String,
    fix: &str,
    maturity: Option<GateMaturity>,
) -> GateFailure {
    GateFailure {
        code,
        message,
        fix: fix.to_owned(),
        kind: change.kind,
        case_name: change.case_name.clone(),
        pointer: change.pointer.clone(),
        position: change.position,
        breaks: change.breaks.clone(),
        operations: change.operations.clone(),
        maturity,
    }
}

fn change_text(change: &DiffChange) -> String {
    format!(
        "{} ({}) at {}",
        change.kind.as_str(),
        change.case_name,
        change.pointer
    )
}

/// The sides a change breaks, as a sentence part.
pub(crate) fn breaks_text(breaks: &[DiffBreak]) -> String {
    let names: Vec<&str> = breaks.iter().map(|side| side.as_str()).collect();

    names.join(" and ")
}

#[cfg(test)]
mod tests {
    use seampact_diff_table::{DiffClassification, DiffPosition};
    use seampact_ir::Deprecation;

    use super::*;
    use crate::sample_ir::sample_ir;

    const OPERATION: &str = "mixed";

    fn removed_operation() -> DiffChange {
        DiffChange {
            kind: DiffKind::OperationRemoved,
            case_name: "removed".to_owned(),
            pointer: "/operations/1".to_owned(),
            position: DiffPosition::None,
            operations: vec![OPERATION.to_owned()],
            breaks: vec![DiffBreak::Clients],
            classification: DiffClassification::Breaking,
            before: None,
            after: None,
            cause: None,
            exemption: None,
        }
    }

    fn deprecated_until(sunset: &str) -> ContractIr {
        let mut ir = sample_ir();

        for operation in &mut ir.operations {
            if operation.id.as_str() == OPERATION {
                operation.deprecated = Some(Deprecation {
                    since: "2026-01-01".to_owned(),
                    sunset: sunset.to_owned(),
                    successor: None,
                    successor_rel: None,
                    origin: operation.origin.clone(),
                });
            }
        }

        ir
    }

    #[test]
    fn a_removal_is_past_its_sunset_on_the_sunset_day_itself() {
        let change = removed_operation();

        assert!(is_removal_past_sunset(
            &change,
            &deprecated_until("2026-10-20"),
            "2026-10-20"
        ));
        assert!(is_removal_past_sunset(
            &change,
            &deprecated_until("2026-10-19"),
            "2026-10-20"
        ));
        assert!(!is_removal_past_sunset(
            &change,
            &deprecated_until("2026-10-21"),
            "2026-10-20"
        ));
        assert!(!is_removal_past_sunset(&change, &sample_ir(), "2026-10-20"));
    }

    #[test]
    fn a_change_of_an_api_with_no_operation_is_experimental_when_the_api_is() {
        let mut change = removed_operation();
        let mut ir = sample_ir();

        change.operations.clear();

        assert!(!is_on_experimental(&change, &ir));

        ir.api.maturity = Maturity::Experimental;

        assert!(is_on_experimental(&change, &ir));
    }

    #[test]
    fn a_stable_operation_adds_a_maturity_failure_after_the_policy_failure() {
        let change = removed_operation();
        let mut before = sample_ir();

        for operation in &mut before.operations {
            if operation.id.as_str() == OPERATION {
                operation.maturity.level = Maturity::Stable;
                operation.maturity.source = MaturitySource::Stated;
            }
        }

        let failure = policy_failure(&change);
        let stable = stable_failures(&change, &before, &sample_ir());

        assert_eq!(failure.code, DiffCode::PolicyBreaking);
        assert_eq!(
            failure.message,
            "operation.removed (removed) at /operations/1 breaks clients on mixed, and compat.policy is additive-only."
        );
        assert_eq!(stable.len(), 1);
        assert_eq!(
            stable
                .first()
                .and_then(|found| found.maturity.as_ref())
                .map(|maturity| {
                    (
                        maturity.operation.as_deref(),
                        maturity.level.as_str(),
                        maturity.source.as_str(),
                    )
                }),
            Some((Some(OPERATION), "stable", "stated"))
        );
    }
}
