//! The release gate: under `additive-only` every change breaking a gated side fails, unless an
//! exemption covers it; under `none` the changes are reported and the gate passes.

use seampact_diff_table::{
    DiffBreak, DiffChange, DiffExemption, DiffGateScope, GateFailure, ResolvedDiffOptions,
};
use seampact_ir::{CompatPolicy, ContractIr};

use crate::DiffError;
use crate::not_ported::not_ported_yet;

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
/// # Errors
///
/// [`DiffError::NotPortedYet`] until the exemption and failure builders are ported.
pub(crate) fn apply_gate(
    changes: &mut [DiffChange],
    before: &ContractIr,
    after: &ContractIr,
    options: &ResolvedDiffOptions,
) -> Result<Vec<GateFailure>, DiffError> {
    let applied = applied_policy(&before.api.compat.policy, &after.api.compat.policy);

    if applied != CompatPolicy::AdditiveOnly {
        return Ok(Vec::new());
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

        if let Some(exemption) = exemption_of(change, before, options)? {
            change.exemption = Some(exemption);

            continue;
        }

        failures.push(policy_failure(change)?);
        failures.extend(stable_failures(change, before, after)?);
    }

    Ok(failures)
}

/// The exemption that covers `change`, if one does.
///
/// # Errors
///
/// Not ported yet.
fn exemption_of(
    _change: &DiffChange,
    _before: &ContractIr,
    _options: &ResolvedDiffOptions,
) -> Result<Option<DiffExemption>, DiffError> {
    Err(not_ported_yet("exemptionOf"))
}

/// The `diff.policy.breaking` failure of `change`.
///
/// # Errors
///
/// Not ported yet.
fn policy_failure(_change: &DiffChange) -> Result<GateFailure, DiffError> {
    Err(not_ported_yet("policyFailure"))
}

/// The `diff.maturity.stable` failures of `change`.
///
/// # Errors
///
/// Not ported yet.
fn stable_failures(
    _change: &DiffChange,
    _before: &ContractIr,
    _after: &ContractIr,
) -> Result<Vec<GateFailure>, DiffError> {
    Err(not_ported_yet("stableFailures"))
}

/// The sides a change breaks, as a sentence part.
pub(crate) fn breaks_text(breaks: &[DiffBreak]) -> String {
    let names: Vec<&str> = breaks.iter().map(|side| side.as_str()).collect();

    names.join(" and ")
}
