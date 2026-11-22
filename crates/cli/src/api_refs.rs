//! The apis a config names and the sources that may hold them.

use std::collections::HashSet;

use seampact_cli_config::{CliProblem, LoadedAppConfig, ResolvedSource};
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;

use crate::cli_problem::{entry_where, located_problem};
use crate::workspace_api_names::workspace_api_names;

/// Separates the source from the api in `<source>/<api>`.
const SOURCE_SEPARATOR: char = '/';

/// An api reference, split into its source (when written) and its api.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ApiRef<'text> {
    pub(crate) source: Option<&'text str>,
    pub(crate) api: &'text str,
}

/// The sources a command reads: all of them named, or why the config refuses.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum UsedSources {
    /// The names of the sources to compile, in config order.
    Used(Vec<String>),
    /// The config names a source it does not have.
    Refused(Vec<CliProblem>),
}

/// The api alone, or `<source>/<api>` split at its first separator.
pub(crate) fn parse_api_ref(text: &str) -> ApiRef<'_> {
    match text.split_once(SOURCE_SEPARATOR) {
        Some((source, api)) => ApiRef {
            source: Some(source),
            api,
        },
        None => ApiRef {
            source: None,
            api: text,
        },
    }
}

/// The `apis` of a target entry, else its `api` as a one-item list, else none.
pub(crate) fn api_refs_of(entry: &JsonValue) -> Vec<&str> {
    let JsonValue::Object(object) = entry else {
        return Vec::new();
    };

    if let Some(JsonValue::Array(apis)) = object.get("apis") {
        return apis
            .iter()
            .filter_map(|api| match api {
                JsonValue::String(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
    }

    match object.get("api") {
        Some(JsonValue::String(api)) => vec![api.as_str()],
        _ => Vec::new(),
    }
}

/// Every api reference of every target entry, in config order.
pub(crate) fn entry_api_refs(config: &LoadedAppConfig) -> Vec<&str> {
    config
        .entries
        .iter()
        .flat_map(|each| api_refs_of(&each.entry))
        .collect()
}

/// One problem for each reference whose source the config does not have.
///
/// # Errors
///
/// [`InternalError`] when an entry has no id, which the config schema requires.
pub(crate) fn unknown_source_problems(
    config: &LoadedAppConfig,
) -> Result<Vec<CliProblem>, InternalError> {
    let known: Vec<&str> = config.sources.keys().map(String::as_str).collect();
    let listed = if known.is_empty() {
        "none".to_owned()
    } else {
        known.join(", ")
    };
    let mut problems = Vec::new();

    for each in &config.entries {
        let id = match &each.entry {
            JsonValue::Object(entry) => entry.get("id"),
            _ => None,
        };
        let entry_id = match id {
            Some(JsonValue::String(id)) => id.as_str(),
            _ => {
                return Err(InternalError::new(
                    "a target entry without an id passed the schema",
                ));
            }
        };

        for reference in api_refs_of(&each.entry).into_iter().map(parse_api_ref) {
            let Some(source) = reference.source else {
                continue;
            };

            if config.sources.contains_key(source) {
                continue;
            }

            problems.push(located_problem(
                "config.api.unknown-source",
                format!("The app config has no source '{source}' ({listed})."),
                "Name one of the app config's `sources` before the '/', or add the source.",
                entry_where(entry_id, Some(reference.api)),
            ));
        }
    }

    Ok(problems)
}

/// The sources the entries and `extra_refs` need, or the problems of an unknown source.
///
/// # Errors
///
/// As [`unknown_source_problems`].
pub(crate) fn used_sources(
    config: &LoadedAppConfig,
    extra_refs: &[String],
) -> Result<UsedSources, InternalError> {
    let problems = unknown_source_problems(config)?;

    if !problems.is_empty() {
        return Ok(UsedSources::Refused(problems));
    }

    let mut refs = entry_api_refs(config);

    refs.extend(extra_refs.iter().map(String::as_str));

    Ok(UsedSources::Used(sources_holding_refs(config, &refs)))
}

/// The sources a reference names, and those that may hold an api named alone, in config order.
pub(crate) fn sources_holding_refs(config: &LoadedAppConfig, refs: &[&str]) -> Vec<String> {
    let parsed: Vec<ApiRef<'_>> = refs.iter().copied().map(parse_api_ref).collect();
    let bare_apis: HashSet<&str> = parsed
        .iter()
        .filter(|reference| reference.source.is_none())
        .map(|reference| reference.api)
        .collect();
    let named: HashSet<&str> = parsed
        .iter()
        .filter_map(|reference| reference.source)
        .collect();

    config
        .sources
        .iter()
        .filter(|(name, source)| {
            named.contains(name.as_str())
                || (!bare_apis.is_empty() && may_hold_any(source, &bare_apis))
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// A bundle may hold any api; a workspace holds those it declares, any when it declares none we
/// can read.
fn may_hold_any(source: &ResolvedSource, apis: &HashSet<&str>) -> bool {
    let ResolvedSource::Path { directory } = source else {
        return true;
    };

    workspace_api_names(directory)
        .is_none_or(|names| names.iter().any(|name| apis.contains(name.as_str())))
}

/// Tells each problem of a source read for a bare api name how to name the api and read only that
/// source.
pub(crate) fn add_qualify_fix(problems: Vec<CliProblem>, refs: &[&str]) -> Vec<CliProblem> {
    let parsed: Vec<ApiRef<'_>> = refs.iter().copied().map(parse_api_ref).collect();
    let named: HashSet<&str> = parsed
        .iter()
        .filter_map(|reference| reference.source)
        .collect();
    let bare_refs: Vec<String> = parsed
        .iter()
        .zip(refs)
        .filter(|(reference, _)| reference.source.is_none())
        .map(|(_, text)| format!("'{text}'"))
        .collect();

    problems
        .into_iter()
        .map(|problem| {
            let source = problem.location.as_deref().and_then(source_named_by);

            match source {
                Some(source) if !named.contains(source) && !bare_refs.is_empty() => CliProblem {
                    fix: format!(
                        "{} The source is read because an api is named alone ({}); name each as `<source>/<api>` and only that source is read.",
                        problem.fix,
                        bare_refs.join(", ")
                    ),
                    ..problem
                },
                _ => problem,
            }
        })
        .collect()
}

/// The source of a location that starts `source '<name>'`.
fn source_named_by(location: &str) -> Option<&str> {
    let (name, _) = location.strip_prefix("source '")?.split_once('\'')?;

    (!name.is_empty()).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_location_names_its_source_only_when_it_starts_with_one() {
        let cases = [
            ("source 'api'", Some("api")),
            ("source 'api', workspace.imports.x", Some("api")),
            ("source ''", None),
            ("source 'open", None),
            ("entry 'a', api 'b'", None),
            (" source 'api'", None),
        ];

        for (location, expected) in cases {
            assert_eq!(source_named_by(location), expected, "{location:?}");
        }
    }

    #[test]
    fn an_api_ref_splits_at_its_first_slash() {
        assert_eq!(
            parse_api_ref("billing/orders/v2"),
            ApiRef {
                source: Some("billing"),
                api: "orders/v2"
            }
        );
        assert_eq!(
            parse_api_ref("orders"),
            ApiRef {
                source: None,
                api: "orders"
            }
        );
    }
}
