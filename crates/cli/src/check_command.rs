//! `seampact check`: regenerates the run in memory and reports drift from the files on disk.

use seampact_cli_config::{CliIo, print_warnings};
use seampact_generate::{PlanInputs, RunConfigLocation, Stop, find_write_drift, prepare_run};
use seampact_target::Registry;
use seampact_writer::HandEditPolicy;

use crate::run_cli::PluginRun;
use crate::{CliError, EXIT_SUCCESS, refuse};

/// Plans the run, generates every entry and document, and compares them with the written files.
///
/// # Errors
///
/// [`CliError`] when a file cannot be read, or for a bug.
pub(crate) fn check_command(
    run: &PluginRun,
    registry: &Registry,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let location = RunConfigLocation {
        file: &run.location.file,
        display_name: &run.location.display_name,
        text_file: run.text_file.as_deref(),
    };
    let inputs = PlanInputs {
        local_bundles: &run.local_bundles,
    };
    let prepared = match prepare_run(&location, io, HandEditPolicy::Refuse, &inputs, registry) {
        Ok(prepared) => prepared,
        Err(Stop::Refused(problems)) => return Ok(refuse(io, problems.as_slice())),
        Err(Stop::Failed(failure)) => return Err(failure.into()),
    };
    let drift = find_write_drift(&prepared)?;

    print_warnings(io, &drift.warnings);

    if !drift.errors.is_empty() {
        return Ok(refuse(io, &drift.errors));
    }

    io.stdout("check: the generated files and documents match the committed ones.\n");

    Ok(EXIT_SUCCESS)
}
