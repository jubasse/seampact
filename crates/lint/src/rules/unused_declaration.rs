//! A declaration no operation, identity or convention reaches (ADR 0004 section 2).

use seampact_ir::Layer;

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::lint_owns_origin;

/// The layers the contract's authors own, less `shared`: the runner sees one api, and a shared
/// file, like a pack, offers entries to every api of the workspace, so one api not using an entry
/// is no defect.
fn is_authored_layer(layer: &Layer) -> bool {
    matches!(layer, Layer::Api | Layer::Base)
}

/// The findings of the rule `seampact/unused-declaration`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let mut findings = Vec::new();

    for entry in context.declared {
        if entry.reached || !is_authored_layer(&entry.origin.layer) {
            continue;
        }

        if !lint_owns_origin(&entry.origin) {
            continue;
        }

        findings.push(LintFinding {
            message: format!(
                "The declaration '{}' in {} is reached by no operation, identity or convention.",
                entry.id, entry.catalogue
            ),
            fix: format!(
                "Remove '{}', use it, or allow seampact/unused-declaration on it with a reason.",
                entry.id
            ),
            origin: entry.origin.clone(),
            allow_at: vec![entry.origin.clone()],
        });
    }

    findings
}
