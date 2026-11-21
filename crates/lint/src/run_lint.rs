//! The lint of one compiled api.

use seampact_authoring::Locations;
use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, Severity, diagnostic_location_key, diagnostic_sort,
};
use seampact_ir::{ContractIr, Origin};
use seampact_pipeline::PipelineDeclared;
use seampact_span::SourceFiles;

use crate::LintError;
use crate::core_rule::CoreRule;
use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::resolve::{
    EffectiveSeverity, diagnostic_origin_of, lint_is_allowed, lint_severity_of,
    lint_unknown_rule_diagnostics,
};

/// What the lint of one api reads, borrowed from the compilation.
#[derive(Debug, Clone, Copy)]
pub struct RunLintInput<'input> {
    /// The finalized IR of the api.
    pub ir: &'input ContractIr,
    /// The api's declared catalogue entries.
    pub declared: &'input [PipelineDeclared],
    /// The api's whole side table.
    pub locations: &'input Locations,
    /// The files the side table points into, which give the diagnostics their sort positions.
    pub source_files: &'input SourceFiles,
}

/// The diagnostics of the core rules over one api, sorted.
///
/// # Errors
///
/// [`LintError::Internal`] for a finding no side table entry locates, a relay copy reported, or a
/// severity setting that is none of `disabled`, `warning` and `error`.
pub fn run_lint(input: &RunLintInput<'_>) -> Result<Vec<Diagnostic>, LintError> {
    let lint = &input.ir.lint;
    let context = LintRuleContext {
        ir: input.ir,
        declared: input.declared,
    };
    let mut diagnostics = lint_unknown_rule_diagnostics(lint, input.locations)?;

    for rule in CoreRule::ALL {
        let id = rule.as_str();
        let default = EffectiveSeverity::Reported(Severity::Warning);
        let EffectiveSeverity::Reported(severity) = lint_severity_of(lint, id, default)? else {
            continue;
        };

        for finding in rule.check(&context) {
            if lint_is_allowed(lint, id, &finding.allow_at) {
                continue;
            }

            diagnostics.push(diagnostic_of(*rule, severity, &finding, input.locations)?);
        }
    }

    let located = input
        .source_files
        .locations(input.locations)
        .map_err(InternalError::from)?;

    Ok(diagnostic_sort(diagnostics, &located))
}

fn diagnostic_of(
    rule: CoreRule,
    severity: Severity,
    finding: &LintFinding,
    locations: &Locations,
) -> Result<Diagnostic, InternalError> {
    Ok(Diagnostic {
        severity,
        rule: rule.rule_id(),
        message: finding.message.clone(),
        fix: finding.fix.clone(),
        origin: finding_origin(rule, &finding.origin, locations)?,
        related: Vec::new(),
    })
}

fn finding_origin(
    rule: CoreRule,
    origin: &Origin,
    locations: &Locations,
) -> Result<DiagnosticOrigin, InternalError> {
    if let Some(api) = &origin.api {
        return Err(InternalError::new(format!(
            "the lint rule '{rule}' reported a finding at a relay copy from api '{api}': report at the api that declares it",
            rule = rule.as_str()
        )));
    }

    let located = diagnostic_origin_of(origin)?;
    let key = diagnostic_location_key(&located);

    if !locations.contains_key(&key) {
        return Err(InternalError::new(format!(
            "the lint rule '{}' reported a finding at '{key}', which the side table lacks",
            rule.as_str()
        )));
    }

    Ok(located)
}
