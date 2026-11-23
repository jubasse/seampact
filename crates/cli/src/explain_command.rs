//! `seampact explain`: prints one operation of a compiled api as commented YAML.

use indexmap::IndexMap;
use seampact_cli_config::CliIo;
use seampact_cli_config::unlocated_problem;
use seampact_cli_config::{
    ApiRef, CliProblem, ReadAppConfigOutcome, parse_api_ref, read_app_config,
};
use seampact_generate::LocalBundles;
use seampact_generate::sources_holding_refs;
use seampact_generate::{CompiledApi, compile_sources};
use seampact_js::cmp_utf16;
use seampact_span::Location;

use crate::config_location::ConfigLocation;
use crate::explain_view::explain_operation_text;
use crate::{CliError, EXIT_SUCCESS, refuse};

/// Separates the api from the operation id in `<api>.<operationId>`.
const OPERATION_SEPARATOR: char = '.';

/// What `explain` was asked to print: an operation, and the api it belongs to when given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExplainTarget<'text> {
    pub(crate) api: Option<ApiRef<'text>>,
    pub(crate) api_text: Option<&'text str>,
    pub(crate) operation_id: &'text str,
}

/// The operation id alone, or `<api>.<operationId>` split at its last separator.
pub(crate) fn explain_target(text: &str) -> ExplainTarget<'_> {
    match text.rsplit_once(OPERATION_SEPARATOR) {
        None => ExplainTarget {
            api: None,
            api_text: None,
            operation_id: text,
        },
        Some((api_text, operation_id)) => ExplainTarget {
            api: Some(parse_api_ref(api_text)),
            api_text: Some(api_text),
            operation_id,
        },
    }
}

/// Prints the operation `operation_text` (`<api>.<operationId>`, or the id alone when the sources
/// hold one api) of the apis the app config's sources compile to; answers the exit code.
///
/// # Errors
///
/// [`CliError::Io`], [`CliError::Fetch`] or [`CliError::Internal`] when a source cannot be read.
pub(crate) fn explain_command(
    location: &ConfigLocation,
    operation_text: &str,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let target = explain_target(operation_text);
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let names: Vec<String> = match target.api_text {
        None => config.sources.keys().cloned().collect(),
        Some(api_text) => sources_holding_refs(&config, &[api_text]),
    };
    let compiled = compile_sources(&config, &names, &LocalBundles::new(), io)?;

    if compiled.failed {
        return Ok(refuse(io, &compiled.problems));
    }

    let chosen = match chosen_api(&compiled.apis, &target) {
        Ok(chosen) => chosen,
        Err(problem) => return Ok(refuse(io, &[*problem])),
    };
    let ir = &chosen.ir;
    let Some(operation) = ir
        .operations
        .iter()
        .find(|each| each.id.as_str() == target.operation_id)
    else {
        let mut known: Vec<&str> = ir.operations.iter().map(|each| each.id.as_str()).collect();

        known.sort_by(|left, right| cmp_utf16(left, right));

        let listed = if known.is_empty() {
            "none".to_owned()
        } else {
            known.join(", ")
        };

        return Ok(refuse(
            io,
            &[unlocated_problem(
                "explain.operation.unknown",
                format!(
                    "The api '{}' has no operation '{}' ({listed}).",
                    chosen.api, target.operation_id
                ),
                "Name one of its operation ids, as the IR and the OpenAPI document spell it.",
            )],
        ));
    };
    let no_locations = IndexMap::<String, Location>::new();
    let locations = chosen
        .lint_input
        .as_ref()
        .map_or(&no_locations, |input| &input.located);

    io.stdout(&explain_operation_text(ir, operation, locations)?);

    Ok(EXIT_SUCCESS)
}

/// The one api the target names, or the problem of none, several without a name, or several
/// sources holding the name.
fn chosen_api<'compiled>(
    apis: &'compiled [CompiledApi],
    target: &ExplainTarget<'_>,
) -> Result<&'compiled CompiledApi, Box<CliProblem>> {
    let candidates: Vec<&CompiledApi> = apis
        .iter()
        .filter(|each| match &target.api {
            None => true,
            Some(reference) => {
                each.api == reference.api
                    && reference.source.is_none_or(|source| each.source == source)
            }
        })
        .collect();

    if let [only] = candidates.as_slice() {
        return Ok(only);
    }

    let held: Vec<String> = apis
        .iter()
        .map(|each| format!("'{}/{}'", each.source, each.api))
        .collect();
    let held = if held.is_empty() {
        "none".to_owned()
    } else {
        held.join(", ")
    };

    let problem = match (&target.api, candidates.is_empty()) {
        (_, true) => unlocated_problem(
            "explain.api.unknown",
            match target.api_text {
                None => "The sources of the app config hold no api.".to_owned(),
                Some(api_text) => format!("No source of the app config holds an api '{api_text}'."),
            },
            "Name an api of a source, as `<api>.<operationId>` or `<source>/<api>.<operationId>`.",
        ),
        (None, false) => unlocated_problem(
            "explain.api.needed",
            format!(
                "The sources hold several apis ({held}), so the operation id alone does not name one."
            ),
            &format!(
                "Name the api: `seampact explain <api>.{}`.",
                target.operation_id
            ),
        ),
        (Some(reference), false) => unlocated_problem(
            "explain.api.ambiguous",
            format!(
                "The api '{}' exists in several sources ({held}).",
                reference.api
            ),
            &format!(
                "Name it as `<source>/{}.{}`.",
                reference.api, target.operation_id
            ),
        ),
    };

    Err(Box::new(problem))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operation_id_follows_the_last_dot() {
        let target = explain_target("billing/orders.v2.getOrder");

        assert_eq!(target.api_text, Some("billing/orders.v2"));
        assert_eq!(target.operation_id, "getOrder");
        assert_eq!(
            target.api,
            Some(ApiRef {
                source: Some("billing"),
                api: "orders.v2"
            })
        );
        assert_eq!(explain_target("getOrder").api, None);
    }
}
