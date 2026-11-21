//! The lint of one compiled api.

use seampact_authoring::Locations;
use seampact_diagnostics::Diagnostic;
use seampact_ir::ContractIr;
use seampact_pipeline::PipelineDeclared;

use crate::LintError;
use crate::not_ported::not_ported_yet;

/// What the lint of one api reads, borrowed from the compilation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunLintInput<'input> {
    /// The finalized IR of the api.
    pub ir: &'input ContractIr,
    /// The api's declared catalogue entries.
    pub declared: &'input [PipelineDeclared],
    /// The api's whole side table.
    pub locations: &'input Locations,
}

/// The diagnostics of the core rules over one api, sorted.
///
/// # Errors
///
/// [`LintError::NotPortedYet`] until the function is ported.
pub fn run_lint(_input: &RunLintInput<'_>) -> Result<Vec<Diagnostic>, LintError> {
    Err(not_ported_yet("runLint"))
}
