//! `seampact generate`: writes every entry's files and documents of the run.

use seampact_target::Registry;
use seampact_writer::HandEditPolicy;

use crate::not_ported::not_ported_yet;
use crate::run_cli::PluginRun;
use crate::{CliError, CliIo};

/// The options of `generate` beside the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct GenerateOptions {
    /// What a write does with a hand-edited file (`--force`).
    pub(crate) on_hand_edit: HandEditPolicy,
}

/// Plans the run, generates every entry and document, writes them and reports.
pub(crate) fn generate_command(
    _run: &PluginRun,
    _registry: &Registry,
    _io: &mut dyn CliIo,
    _options: GenerateOptions,
) -> Result<i32, CliError> {
    Err(not_ported_yet("generateCommand"))
}
