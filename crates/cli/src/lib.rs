//! The seampact CLI, ported from `packages/core/cli/src`: argument parsing, dispatch, help, the
//! problem printer and the commands; the binary `seampact` calls [`run_cli`].

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the last brief of the crate"
)]

mod api_refs;
mod args;
mod bundle_command;
mod cli_io;
mod cli_problem;
mod command;
mod compile_command;
mod compile_sources;
mod config_location;
mod contract_position;
mod diff_baseline;
mod diff_command;
mod error;
mod explain_command;
mod explain_flow;
mod explain_not_shown;
mod explain_origin;
mod explain_values;
mod explain_view;
mod init_command;
mod lint_command;
mod local_bundle;
mod not_ported;
#[cfg(feature = "oracle")]
pub mod oracle;
mod run_cli;
mod source_reader;
mod step;
mod workspace_api_names;

use seampact_diagnostics::RuleId;

pub use args::{
    OptionKind, OptionSpec, ParseArgsError, ParsedArgs, Positionals, parse_command_args,
};
pub(crate) use cli_io::refuse;
pub use cli_io::{
    CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE, ProcessIo, print_problems, print_warnings,
};
pub use cli_problem::format_problem;
pub use error::CliError;
pub use run_cli::{run_cli, run_command};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
