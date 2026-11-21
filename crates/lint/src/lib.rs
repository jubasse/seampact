//! The contract lint, ported from `packages/core/lint/src` without the plugin loader (ADR 0031):
//! [`run_lint`] runs the core rules over one compiled api.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod error;
mod not_ported;
mod run_lint;

use seampact_diagnostics::RuleId;

pub use error::LintError;
pub use run_lint::{RunLintInput, run_lint};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
