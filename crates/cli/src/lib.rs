//! The seampact CLI, ported from `packages/core/cli/src`: argument parsing, dispatch, help, the
//! problem printer and the commands; the binary `seampact` calls [`run_cli`].

#[expect(dead_code, reason = "reached only by generate and check, layer 3.3")]
mod api_refs;
mod args;
mod bundle_command;
mod check_command;
mod cli_io;
mod cli_problem;
mod command;
mod compile_command;
mod compile_sources;
mod config_location;
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "reached only by generate and check, layer 3.3")
)]
mod contract_position;
mod diff_baseline;
mod diff_command;
mod document_order;
mod error;
mod explain_command;
mod explain_flow;
mod explain_not_shown;
mod explain_origin;
mod explain_values;
mod explain_view;
mod generate_command;
mod git_ignore;
mod init_command;
mod init_modelines;
mod init_starter;
mod line_end;
mod lint_command;
mod local_bundle;
mod modelines;
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
