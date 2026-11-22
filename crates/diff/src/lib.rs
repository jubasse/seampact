//! The contract diff, ported from `packages/core/diff/src`: [`diff_contracts`] compares two IRs of
//! one api, [`diff_contract_sets`] two sets of apis, and [`format_diff_report`] writes the report.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod change_sink;
mod deprecation;
mod diff_contracts;
mod error;
mod gate;
mod not_ported;
mod report;
#[cfg(test)]
mod sample_ir;
mod walk_access;
mod walk_api;
mod walk_behaviour;
mod walk_body;
mod walk_catalogue;
mod walk_context;
mod walk_contracts;
mod walk_declarations;
mod walk_deprecation;
mod walk_json;
mod walk_maturity;
mod walk_operations;
mod walk_params;
mod walk_reach;
mod walk_refusals;
mod walk_responses;
mod walk_type_use;

pub use diff_contracts::{diff_contract_sets, diff_contracts};
pub use error::DiffError;
pub use report::format_diff_report;
