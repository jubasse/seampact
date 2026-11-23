//! The apis a config names and the sources that may hold them.

use std::collections::HashSet;

use seampact_cli_config::{
    ApiRef, CliProblem, LoadedAppConfig, Problems, ResolvedSource, TargetEntrySettings,
    entry_where, located_problem, parse_api_ref,
};

use crate::compile_sources::CompiledApi;
use crate::workspace_api_names::workspace_api_names;

/// The problem of an api an entry names twice: `text` is the reference that repeats `found`.
fn duplicate_api_problem(
    entry: &TargetEntrySettings,
    text: &str,
    found: &CompiledApi,
) -> CliProblem {
    let entry_id = &entry.id;
    let items: Vec<String> = entry
        .api_refs()
        .into_iter()
        .filter(|each| parse_api_ref(each).api == found.api)
        .map(|each| format!("'{each}'"))
        .collect();

    located_problem(
        "config.api.duplicate",
        format!(
            "The entry '{entry_id}' names the api '{}' more than once ({}); '{text}' is one of them.",
            found.api,
            items.join(", ")
        ),
        "Keep one of them, or give the sources' apis different names.",
        entry_where(entry_id, Some(&found.api)),
    )
}

/// Each api of `entry` found among the `compiled` ones.
///
/// # Errors
///
/// [`Problems`] for a name that resolves to no api, to several, or to an api named twice.
pub fn resolve_entry_apis<'compiled>(
    entry: &TargetEntrySettings,
    compiled: &'compiled [CompiledApi],
) -> Result<Vec<&'compiled CompiledApi>, Problems> {
    let entry_id = entry.id.as_str();
    let mut apis: Vec<&CompiledApi> = Vec::new();
    let mut problems = Vec::new();

    for text in entry.api_refs() {
        let reference = parse_api_ref(text);
        let candidates: Vec<&CompiledApi> = compiled
            .iter()
            .filter(|each| {
                each.api == reference.api
                    && reference.source.is_none_or(|source| each.source == source)
            })
            .collect();

        match candidates.as_slice() {
            [] => problems.push(located_problem(
                "config.api.unknown",
                format!("No source of the app config holds an api '{text}'."),
                "Name an api of a source's `workspace.yaml`, as `<api>` or `<source>/<api>`.",
                entry_where(entry_id, Some(reference.api)),
            )),
            [found] if apis.iter().any(|each| each.api == found.api) => {
                problems.push(duplicate_api_problem(entry, text, found));
            }
            [found] => apis.push(found),
            several => {
                let sources: Vec<String> = several
                    .iter()
                    .map(|each| format!("'{}'", each.source))
                    .collect();

                problems.push(located_problem(
                    "config.api.ambiguous",
                    format!(
                        "The api '{}' exists in the sources {}.",
                        reference.api,
                        sources.join(", ")
                    ),
                    &format!("Name it as `<source>/{}`.", reference.api),
                    entry_where(entry_id, Some(reference.api)),
                ));
            }
        }
    }

    Problems::refuse_any(problems)?;

    Ok(apis)
}

/// Every api reference of every target entry, in config order.
#[must_use]
pub fn entry_api_refs(config: &LoadedAppConfig) -> Vec<&str> {
    config
        .entries
        .iter()
        .flat_map(|each| each.settings.api_refs())
        .collect()
}

/// One problem for each reference whose source the config does not have.
#[must_use]
pub fn unknown_source_problems(config: &LoadedAppConfig) -> Vec<CliProblem> {
    let known: Vec<&str> = config.sources.keys().map(String::as_str).collect();
    let listed = if known.is_empty() {
        "none".to_owned()
    } else {
        known.join(", ")
    };
    let mut problems = Vec::new();

    for each in &config.entries {
        let entry_id = &each.settings.id;

        for reference in each.settings.api_refs().into_iter().map(parse_api_ref) {
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

    problems
}

/// The sources the entries and `extra_refs` need, in config order.
///
/// # Errors
///
/// [`Problems`] for a reference whose source the config does not have.
pub fn used_sources(
    config: &LoadedAppConfig,
    extra_refs: &[&str],
) -> Result<Vec<String>, Problems> {
    Problems::refuse_any(unknown_source_problems(config))?;

    let mut refs = entry_api_refs(config);

    refs.extend(extra_refs);

    Ok(sources_holding_refs(config, &refs))
}

/// The sources a reference names, and those that may hold an api named alone, in config order.
pub fn sources_holding_refs(config: &LoadedAppConfig, refs: &[&str]) -> Vec<String> {
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
pub fn add_qualify_fix(problems: Vec<CliProblem>, refs: &[&str]) -> Vec<CliProblem> {
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
