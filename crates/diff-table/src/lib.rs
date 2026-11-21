//! The contract diff's data, ported from `packages/core/diff/src`: the diff codes, the change
//! table, the [`DiffOptions`] and the [`DiffResult`] the diff answers.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod error;
mod not_ported;
mod options;
mod result;
mod table_json;

pub use error::DiffTableError;
pub use options::{DiffExemption, DiffGateScope, DiffOptions};
pub use result::{
    CompatPolicy, DeprecationEntry, DiffChange, DiffComparison, DiffGateOutcome, DiffPolicies,
    DiffRefusal, DiffResult, DiffSettings, DiffSide, GateFailure,
};
pub use table_json::diff_table_json;
