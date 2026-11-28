//! `seampact generate`: writes every entry's files and documents of the run.

use seampact_cli_config::CliIo;
use seampact_generate::{
    PlanInputs, RunConfigLocation, Stop, commit_writes, committable_writes, prepare_run,
};
use seampact_target::Registry;
use seampact_writer::HandEditPolicy;

use crate::run_cli::PluginRun;
use crate::{CliError, EXIT_SUCCESS, refuse};

/// The options of `generate` beside the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct GenerateOptions {
    /// What a write does with a hand-edited file (`--force`).
    pub(crate) on_hand_edit: HandEditPolicy,
}

/// Plans the run, generates every entry and document, writes them and reports.
///
/// # Errors
///
/// [`CliError`] when a file cannot be read or written, or for a bug.
pub(crate) fn generate_command(
    run: &PluginRun,
    registry: &Registry,
    io: &mut dyn CliIo,
    options: GenerateOptions,
) -> Result<i32, CliError> {
    let location = RunConfigLocation {
        file: &run.location.file,
        display_name: &run.location.display_name,
        text_file: run.text_file.as_deref(),
    };
    let inputs = PlanInputs {
        local_bundles: &run.local_bundles,
    };
    let prepared = match prepare_run(&location, io, options.on_hand_edit, &inputs, registry) {
        Ok(prepared) => prepared,
        Err(Stop::Refused(problems)) => return Ok(refuse(io, problems.as_slice())),
        Err(Stop::Failed(failure)) => return Err(failure.into()),
    };
    let writes = match committable_writes(prepared) {
        Ok(writes) => writes,
        Err(Stop::Refused(problems)) => return Ok(refuse(io, problems.as_slice())),
        Err(Stop::Failed(failure)) => return Err(failure.into()),
    };

    commit_writes(writes, io)?;

    Ok(EXIT_SUCCESS)
}
