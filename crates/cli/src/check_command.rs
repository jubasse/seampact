//! `seampact check`: regenerates the run in memory and reports drift from the files on disk.

use seampact_cli_config::CliIo;
use seampact_target::Registry;

use crate::CliError;
use crate::not_ported::not_ported_yet;
use crate::run_cli::PluginRun;

/// Plans the run, generates every entry and document, and compares them with the written files.
pub(crate) fn check_command(
    _run: &PluginRun,
    _registry: &Registry,
    _io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    Err(not_ported_yet("checkCommand"))
}
