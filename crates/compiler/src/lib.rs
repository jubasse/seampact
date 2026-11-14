//! The compiler of the Rust port: the stages in run order.
//!
//! [`compile_workspace`] runs them under the stop rule of ADR 0006: load, validate, the relay
//! order, the six halves of each api, link, finalize. A stage that is not ported ends the run with
//! [`PipelineRun::NotPorted`]; [`run_tree_schemas`] and [`run_half`] do the same for one half. With the `oracle` feature,
//! [`oracle::CompilerSubject`] implements the oracle's `OracleSubject` over them. The shipped CLI
//! is built without the feature and carries no harness.

mod context;
mod half_run;
mod orchestrator;
mod relay;
mod result;
mod stages;

#[cfg(feature = "oracle")]
pub mod oracle;

pub use context::HalfReaders;
pub use half_run::{HalfRun, TreeSchemasRun, run_half, run_tree_schemas};
pub use orchestrator::{PipelineOptions, PipelineRun, compile_workspace};
pub use relay::{check_relay_order, relays_to_stopped};
pub use result::{PipelineApiResult, PipelineResult};
pub use stages::{
    FinalizeRun, Finalized, RelayOrder, Stage, StageAnswer, Validated, finalize_api,
    link_workspace, validate_workspace, workspace_relay_order,
};
