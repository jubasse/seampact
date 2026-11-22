//! `seampact diff`: classifies what changed since the IRs `--against` names.

use indexmap::IndexMap;
use seampact_cli_config::{
    ReadAppConfigOutcome, open_api_api_names, read_app_config, resolved_path,
};
use seampact_diagnostics::InternalError;
use seampact_diff::{diff_contract_sets, format_diff_report};
use seampact_diff_table::{DiffExemption, DiffGateScope, DiffOptions, DiffResult};
use seampact_json::JsonValue;

use crate::api_refs::{UsedSources, add_qualify_fix, entry_api_refs, used_sources};
use crate::cli_problem::unlocated_problem;
use crate::compile_sources::compile_sources;
use crate::config_location::ConfigLocation;
use crate::diff_baseline::read_baseline;
use crate::local_bundle::LocalBundles;
use crate::step::Step;
use crate::{CliError, CliIo, EXIT_REFUSED, EXIT_SUCCESS, refuse};

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
    let used_names = match used_sources(&config, &extra_refs)? {
        UsedSources::Refused(problems) => return Ok(refuse(io, &problems)),
        UsedSources::Used(names) => names,
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

    let baseline = match read_baseline(&resolved_path(io.cwd(), against))? {
        Step::Refused(problems) => return Ok(refuse(io, &problems)),
        Step::Done(baseline) => baseline,
    };
    let compiled = compile_sources(&config, &used_names, &LocalBundles::new(), io)?;

    if compiled.failed {
        let mut refs = entry_api_refs(&config);

        refs.extend(extra_refs.iter().map(String::as_str));

        return Ok(refuse(io, &add_qualify_fix(compiled.problems, &refs)));
    }

    let mut current = IndexMap::new();

    for each in compiled.apis {
        current.insert(each.api, each.ir);
    }

    let options = diff_options(io.today(), config.diff.as_ref())?;
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

/// The diff options of `today` and the `gate` and `exempt` members of the config's `diff`
/// settings, as the config schema allows them.
fn diff_options(today: String, settings: Option<&JsonValue>) -> Result<DiffOptions, InternalError> {
    let members = match settings {
        Some(JsonValue::Object(members)) => Some(members),
        Some(_) => {
            return Err(InternalError::new(
                "diff settings that are no mapping passed the schema",
            ));
        }
        None => None,
    };
    let gate = match members.and_then(|members| members.get("gate")) {
        None => None,
        Some(JsonValue::String(text)) => Some(
            [DiffGateScope::Clients, DiffGateScope::Both]
                .into_iter()
                .find(|scope| scope.as_str() == text)
                .ok_or_else(|| {
                    InternalError::new(format!("a diff gate '{text}' passed the schema"))
                })?,
        ),
        Some(_) => {
            return Err(InternalError::new(
                "a diff gate that is no text passed the schema",
            ));
        }
    };
    let exempt = match members.and_then(|members| members.get("exempt")) {
        None => None,
        Some(JsonValue::Array(items)) => Some(
            items
                .iter()
                .map(exemption_of)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Some(_) => {
            return Err(InternalError::new(
                "diff exemptions that are no list passed the schema",
            ));
        }
    };

    Ok(DiffOptions {
        today,
        gate,
        exempt,
    })
}

fn exemption_of(item: &JsonValue) -> Result<DiffExemption, InternalError> {
    [DiffExemption::Experimental, DiffExemption::SunsetPassed]
        .into_iter()
        .find(|exemption| matches!(item, JsonValue::String(text) if text == exemption.as_str()))
        .ok_or_else(|| InternalError::new("a diff exemption outside the schema's passed it"))
}
