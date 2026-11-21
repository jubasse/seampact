//! The contract diff, ported from `packages/core/diff/src`: [`diff_contracts`] compares two IRs of
//! one api, [`diff_contract_sets`] two sets of apis, and [`format_diff_report`] writes the report.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod diff_contracts;
mod error;
mod not_ported;
mod report;

pub use diff_contracts::{diff_contract_sets, diff_contracts};
pub use error::DiffError;
pub use report::format_diff_report;
