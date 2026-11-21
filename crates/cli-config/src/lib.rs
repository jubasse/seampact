//! The CLI's config reading, ported from `packages/core/cli/src/config`: the app, root, workspace
//! and run configs, each read or refused with [`CliProblem`]s.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod cli_problem;
mod error;
mod not_ported;
mod read_app_config;
mod read_root_config;
mod read_run_config;
mod read_workspace_configs;

use seampact_diagnostics::RuleId;

pub use cli_problem::CliProblem;
pub use error::CliConfigError;
pub use read_app_config::{LoadedAppConfig, ReadAppConfigOutcome, read_app_config};
pub use read_root_config::{LoadedRootConfig, ReadRootConfigOutcome, read_root_config};
pub use read_run_config::{ReadRunConfigOutcome, RunConfig, read_run_config};
pub use read_workspace_configs::{LoadedWorkspace, ReadWorkspaceOutcome, read_workspace_configs};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
