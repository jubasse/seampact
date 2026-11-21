//! The seampact CLI, ported from `packages/core/cli/src`: argument parsing, dispatch, help, the
//! problem printer and the commands; the binary `seampact` calls [`run_cli`].

mod args;
mod cli_io;
mod cli_problem;
mod command;
mod error;
mod not_ported;
#[cfg(feature = "oracle")]
pub mod oracle;
mod run_cli;

use seampact_diagnostics::RuleId;

pub use args::{
    OptionKind, OptionSpec, ParseArgsError, ParsedArgs, Positionals, parse_command_args,
};
pub use cli_io::{
    CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE, ProcessIo, print_problems, print_warnings,
};
pub use cli_problem::format_problem;
pub use error::CliError;
pub use run_cli::{run_cli, run_command};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
