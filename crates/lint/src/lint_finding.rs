//! What a rule reads and what it reports.

use seampact_ir::{ContractIr, Origin};
use seampact_pipeline::PipelineDeclared;

/// What a rule's check reads.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LintRuleContext<'run> {
    /// The finalized IR of the api.
    pub(crate) ir: &'run ContractIr,
    /// The api's declared catalogue entries.
    pub(crate) declared: &'run [PipelineDeclared],
}

/// One finding of a rule.
///
/// The core rules never relate a second position, so a finding has no `related` list.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LintFinding {
    /// What is wrong.
    pub(crate) message: String,
    /// What to do about it.
    pub(crate) fix: String,
    /// Where it is reported.
    pub(crate) origin: Origin,
    /// The places an allow may sit to silence it.
    pub(crate) allow_at: Vec<Origin>,
}
