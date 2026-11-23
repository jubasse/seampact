//! `seampact diff`: classifies what changed since the IRs `--against` names.

use indexmap::IndexMap;
use seampact_cli_config::CliIo;
use seampact_cli_config::unlocated_problem;
use seampact_cli_config::{
    ReadAppConfigOutcome, open_api_api_names, read_app_config, resolved_path,
};
use seampact_diff::{diff_contract_sets, format_diff_report};
use seampact_diff_table::DiffResult;
use seampact_generate::LocalBundles;
use seampact_generate::compile_sources;
use seampact_generate::{add_qualify_fix, entry_api_refs, used_sources};

use crate::config_location::ConfigLocation;
use crate::diff_baseline::read_baseline;
use crate::stop::Stop;
use crate::{CliError, EXIT_REFUSED, EXIT_SUCCESS, refuse};

/// Compares the compiled sources with the baseline at `against`, one report per api; answers
/// the exit code, refused when a comparison fails its gate.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read, [`CliError::Internal`] for a bug.
pub(crate) fn diff_command(
    location: &ConfigLocation,
    against: &str,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let extra_refs = open_api_api_names(&config);
    let used_names = match used_sources(&config, &extra_refs) {
        Err(problems) => return Ok(refuse(io, problems.as_slice())),
        Ok(names) => names,
    };

    if used_names.is_empty() {
        return Ok(refuse(
            io,
            &[unlocated_problem(
                "diff.no-api",
                "The app config names no api, so there is nothing to compare.".to_owned(),
                "Name an api in a target entry's `api` or `apis`, or in `openapi`.",
            )],
        ));
    }

    let baseline = match read_baseline(&resolved_path(io.cwd(), against)) {
        Err(Stop::Refused(problems)) => return Ok(refuse(io, problems.as_slice())),
        Err(Stop::Failed(failure)) => return Err(failure),
        Ok(baseline) => baseline,
    };
    let compiled = compile_sources(&config, &used_names, &LocalBundles::new(), io)?;

    if compiled.failed {
        let mut refs = entry_api_refs(&config);

        refs.extend(extra_refs);

        return Ok(refuse(io, &add_qualify_fix(compiled.problems, &refs)));
    }

    let mut current = IndexMap::new();

    for each in compiled.apis {
        current.insert(each.api, each.ir);
    }

    let options = config
        .diff
        .clone()
        .unwrap_or_default()
        .into_options(io.today());
    let results = diff_contract_sets(&baseline, &current, &options)?;
    let mut failed = false;

    for result in results.values() {
        io.stdout(&format_diff_report(result)?);

        failed |= match result {
            DiffResult::Refused(_) => true,
            DiffResult::Compared(comparison) => !comparison.gate.passed,
        };
    }

    Ok(if failed { EXIT_REFUSED } else { EXIT_SUCCESS })
}
