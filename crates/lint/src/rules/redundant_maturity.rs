//! A stated maturity equal to the derived one (grammar section 10).

use seampact_ir::{ContractIr, Maturity, MaturitySource, Operation};

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::{lint_group_by_origin, lint_node_of, lint_owns_origin, lint_routes_named};

/// The maturity an operation derives when it states none (grammar 10): its owning service's, else
/// the api's.
fn derived_level<'ir>(ir: &'ir ContractIr, operation: &Operation) -> &'ir Maturity {
    operation
        .upstream
        .first()
        .and_then(|owner| ir.services.get(owner.as_str()))
        .map_or(&ir.api.maturity, |service| &service.maturity)
}

/// The findings of the rule `seampact/redundant-maturity`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let ir = context.ir;
    let redundant = ir
        .operations
        .iter()
        .filter(|operation| {
            operation.maturity.source == MaturitySource::Stated
                && lint_owns_origin(&operation.maturity.origin)
                && operation.maturity.level == *derived_level(ir, operation)
        })
        .map(|operation| (&operation.maturity.origin, operation));
    let mut findings = Vec::new();

    for group in lint_group_by_origin(redundant) {
        let Some(first) = group.entries.first() else {
            continue;
        };

        findings.push(LintFinding {
            message: format!(
                "The maturity '{}' written for {} equals the derived maturity.",
                first.maturity.level,
                lint_routes_named(&group.entries)
            ),
            fix: "Remove the maturity, or allow seampact/redundant-maturity on its node with a reason."
                .to_owned(),
            origin: group.origin.clone(),
            allow_at: vec![lint_node_of(group.origin)],
        });
    }

    findings
}
