//! `seampact lint`: the core lint rules over each `path` source's contract.

use seampact_cli_config::CliIo;
use seampact_cli_config::unlocated_problem;
use seampact_cli_config::{ReadAppConfigOutcome, ResolvedSource, read_app_config};
use seampact_diagnostics::{Diagnostic, InternalError, Severity, print_diagnostics};
use seampact_generate::LocalBundles;
use seampact_generate::compile_sources;
use seampact_lint::{RunLintInput, run_lint};

use crate::config_location::ConfigLocation;
use crate::{CliError, EXIT_REFUSED, EXIT_SUCCESS, refuse};

/// Lints every `path` source of the app config and answers the exit code: refused when a
/// diagnostic is an error.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read, [`CliError::Internal`] for a bug.
pub(crate) fn lint_command(location: &ConfigLocation, io: &mut dyn CliIo) -> Result<i32, CliError> {
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let mut path_sources: Vec<String> = Vec::new();

    for (name, source) in &config.sources {
        match source {
            ResolvedSource::Path { .. } => path_sources.push(name.clone()),
            ResolvedSource::Bundle(_) => io.stdout(&format!(
                "Skipped the bundle source '{name}': it holds a compiled IR, and lint reads the contract.\n"
            )),
        }
    }

    if path_sources.is_empty() {
        return Ok(refuse(
            io,
            &[unlocated_problem(
                "lint.no-source",
                "The app config has no `path` source whose contract could be linted.".to_owned(),
                "Add a source `{ path: <contract workspace directory> }` to `sources`.",
            )],
        ));
    }

    let compiled = compile_sources(&config, &path_sources, &LocalBundles::new(), io)?;

    if compiled.failed {
        return Ok(refuse(io, &compiled.problems));
    }

    let mut errors = 0_usize;
    let mut warnings = 0_usize;

    for each in &compiled.apis {
        let Some(input) = &each.lint_input else {
            return Err(InternalError::new(format!(
                "the compiled api {}/{} has no lint input",
                each.source, each.api
            ))
            .into());
        };
        let Some(source_files) = compiled.source_files.get(&each.source) else {
            return Err(InternalError::new(format!(
                "the compiled source {} has no files",
                each.source
            ))
            .into());
        };
        let diagnostics = run_lint(&RunLintInput {
            ir: &each.ir,
            declared: &input.declared,
            locations: &input.spans,
            source_files,
        })?;
        let error_count = diagnostics.iter().filter(|each| is_error(each)).count();

        errors += error_count;
        warnings += diagnostics.len() - error_count;

        if !diagnostics.is_empty() {
            io.stderr(&format!(
                "In source '{}', api '{}':\n{}\n",
                each.source,
                each.api,
                print_diagnostics(&diagnostics, &input.located)
            ));
        }
    }

    io.stdout(&format!(
        "Linted {} api(s): {errors} error(s), {warnings} warning(s).\n",
        compiled.apis.len()
    ));

    Ok(if errors > 0 {
        EXIT_REFUSED
    } else {
        EXIT_SUCCESS
    })
}

fn is_error(diagnostic: &Diagnostic) -> bool {
    diagnostic.severity == Severity::Error
}
