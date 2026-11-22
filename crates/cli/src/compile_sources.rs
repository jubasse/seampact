//! Compiling or fetching the sources a command reads, printing their diagnostics on stderr.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_authoring::Locations;
use seampact_bundle::BundleSource;
use seampact_bundle_fetch::{
    ALLOW_LOCAL_VARIABLE, BundleFetchOptions, BundleFetchResult, BundleSourceFailure,
    CACHE_DIRECTORY_VARIABLE, Environment, LocalSourcePolicy, UreqReleaseGet,
    WorkspaceImportsOptions, WorkspaceImportsResult, compile_workspace_with_imports, fetch_bundle,
    local_source_policy, local_source_refusal_reason,
};
use seampact_cli_config::{CliProblem, LoadedAppConfig, ResolvedSource};
use seampact_compiler::{PipelineOptions, PipelineResult};
use seampact_diagnostics::{Diagnostic, InternalError, Severity, print_diagnostics, quote_text};
use seampact_finalize::finalize_canonical_ir;
use seampact_ir::ContractIr;
use seampact_load::LoadOptions;
use seampact_pipeline::PipelineDeclared;
use seampact_span::{Location, SourceFiles};

use crate::cli_problem::located_problem;
use crate::local_bundle::{LocalBundleOutcome, LocalBundles, verify_local_bundle};
use crate::source_reader::source_reader;
use crate::workspace_api_names::{SINGLE_API_ENTRY, WORKSPACE_ENTRY, source_entry_file};
use crate::{CliError, CliIo};

/// The release channel's GET, shared by every fetch of a run.
static RELEASE_GET: UreqReleaseGet = UreqReleaseGet;

/// What `lint` reads of an api besides its IR; absent for an api taken from a bundle, which no
/// compiler ran on.
#[derive(Debug, Clone)]
pub(crate) struct LintInput {
    pub(crate) declared: Vec<PipelineDeclared>,
    pub(crate) spans: Locations,
    /// The spans as file, line and column, which print and locate editor declarations.
    pub(crate) located: IndexMap<String, Location>,
}

/// One api of a source, compiled or read from a bundle.
#[derive(Debug, Clone)]
pub(crate) struct CompiledApi {
    pub(crate) source: String,
    pub(crate) api: String,
    pub(crate) ir: ContractIr,
    pub(crate) lint_input: Option<LintInput>,
}

/// Every api of the sources a command read, and why it may not go on.
#[derive(Debug, Clone, Default)]
pub(crate) struct CompiledSources {
    /// True when a source reported an error: its diagnostics are printed and nothing may be
    /// generated.
    pub(crate) failed: bool,
    pub(crate) problems: Vec<CliProblem>,
    pub(crate) apis: Vec<CompiledApi>,
    /// The files each compiled source's side tables point into, by source name.
    pub(crate) source_files: IndexMap<String, SourceFiles>,
}

/// What every source of one run shares.
struct SourceRun<'run> {
    local_sources: LocalSourcePolicy,
    environment: Environment,
    config_directory: Utf8PathBuf,
    cache_directory: Option<Utf8PathBuf>,
    local_bundles: &'run LocalBundles,
}

/// Compiles the `path` sources and fetches the bundle sources `names` lists, in that order.
///
/// A `path` source is refused when local sources are (`allowLocal: false`,
/// `SEAMPACT_ALLOW_LOCAL=false`).
///
/// # Errors
///
/// [`CliError::Io`], [`CliError::Fetch`] or [`CliError::Internal`] when a source cannot be read.
pub(crate) fn compile_sources(
    config: &LoadedAppConfig,
    names: &[String],
    local_bundles: &LocalBundles,
    io: &mut dyn CliIo,
) -> Result<CompiledSources, CliError> {
    let environment = run_environment(io);
    let run = SourceRun {
        local_sources: local_source_policy(config.allow_local, &environment),
        config_directory: config
            .file
            .parent()
            .map_or_else(|| config.file.clone(), Utf8Path::to_path_buf),
        cache_directory: io
            .environment_variable(CACHE_DIRECTORY_VARIABLE)
            .filter(|directory| !directory.is_empty())
            .map(Utf8PathBuf::from),
        environment,
        local_bundles,
    };
    let mut compiled = CompiledSources::default();

    for name in names {
        let Some(source) = config.sources.get(name) else {
            return Err(
                InternalError::new(format!("no source named {name} in the app config")).into(),
            );
        };

        match source {
            ResolvedSource::Bundle(written) => {
                take_bundle(name, written, &run, &mut compiled)?;
            }
            ResolvedSource::Path { directory } => {
                compile_source(name, directory, &run, &mut compiled, io)?;
            }
        }
    }

    Ok(compiled)
}

/// The variable the fetch reads from the process, as the command's streams see it.
pub(crate) fn run_environment(io: &dyn CliIo) -> Environment {
    [ALLOW_LOCAL_VARIABLE]
        .into_iter()
        .filter_map(|name| {
            io.environment_variable(name)
                .map(|value| (name.to_owned(), value))
        })
        .collect()
}

fn fetch_options(base_directory: &Utf8Path, run: &SourceRun<'_>) -> BundleFetchOptions<'static> {
    BundleFetchOptions {
        base_directory: base_directory.to_path_buf(),
        local_sources: run.local_sources,
        cache_directory: run.cache_directory.clone(),
        release_get: &RELEASE_GET,
    }
}

fn take_bundle(
    name: &str,
    bundle: &BundleSource,
    run: &SourceRun<'_>,
    compiled: &mut CompiledSources,
) -> Result<(), CliError> {
    let fetched = match run.local_bundles.get(name) {
        Some(directory) => {
            match verify_local_bundle(name, directory, bundle.integrity.as_deref())? {
                LocalBundleOutcome::Refused(problem) => {
                    compiled.failed = true;
                    compiled.problems.push(problem);

                    return Ok(());
                }
                LocalBundleOutcome::Verified(result) => BundleFetchResult::from(result),
            }
        }
        None => fetch_bundle(bundle, &fetch_options(&run.config_directory, run))?,
    };

    let (manifest, irs) = match fetched {
        BundleFetchResult::Failed { failures, .. } => {
            compiled.failed = true;
            compiled.problems.extend(
                failures
                    .iter()
                    .map(|failure| bundle_problem(failure, &format!("source '{name}'"))),
            );

            return Ok(());
        }
        BundleFetchResult::Fetched { manifest, irs, .. } => (manifest, irs),
    };

    for api in &manifest.apis {
        // The check returns the IR of every api its manifest lists.
        let Some(ir) = irs.get(&api.name) else {
            return Err(InternalError::new(format!(
                "the checked bundle of source {name} has no IR for {}",
                api.name
            ))
            .into());
        };

        compiled.apis.push(CompiledApi {
            source: name.to_owned(),
            api: api.name.clone(),
            ir: ir.clone(),
            lint_input: None,
        });
    }

    Ok(())
}

/// A `path` source whose directory holds no contract entry file.
pub(crate) fn no_workspace_problem(name: &str, directory: &Utf8Path) -> CliProblem {
    located_problem(
        "config.source.no-workspace",
        format!(
            "The directory {directory} holds neither `{WORKSPACE_ENTRY}` nor `{SINGLE_API_ENTRY}`."
        ),
        &format!(
            "Point the source's `path` at the contract directory: the one holding `{WORKSPACE_ENTRY}`, or `{SINGLE_API_ENTRY}` for a single api."
        ),
        format!("source '{name}'"),
    )
}

fn compile_source(
    name: &str,
    directory: &Utf8Path,
    run: &SourceRun<'_>,
    compiled: &mut CompiledSources,
    io: &mut dyn CliIo,
) -> Result<(), CliError> {
    if run.local_sources == LocalSourcePolicy::Refuse {
        compiled.failed = true;
        compiled.problems.push(located_problem(
            "config.source.local",
            format!(
                "The source '{name}' is a local path ({directory}), and local sources are refused here ({}).",
                local_source_refusal_reason(&run.environment)
            ),
            "Use a pinned bundle source instead: `{ package, version, integrity }`, `{ release: { url }, integrity }` or `{ git: { url, tag, directory }, integrity }`.",
            format!("source '{name}'"),
        ));

        return Ok(());
    }

    let Some(entry) = source_entry_file(directory) else {
        compiled.failed = true;
        compiled
            .problems
            .push(no_workspace_problem(name, directory));

        return Ok(());
    };

    let reader = source_reader(directory)?;
    let no_imports = IndexMap::new();
    let outcome = compile_workspace_with_imports(&WorkspaceImportsOptions {
        pipeline: PipelineOptions {
            load: LoadOptions {
                reader: &reader,
                entry,
            },
            imports: &no_imports,
        },
        fetch: fetch_options(directory, run),
    })?;

    let result = match outcome {
        WorkspaceImportsResult::Failed(failures) => {
            compiled.failed = true;
            compiled.problems.extend(failures.iter().flat_map(|each| {
                each.failures.iter().map(|failure| {
                    bundle_problem(
                        failure,
                        &format!("source '{name}', workspace.imports.{}", each.name),
                    )
                })
            }));

            return Ok(());
        }
        WorkspaceImportsResult::Compiled(result) => result,
    };

    if print_source_diagnostics(io, name, directory, &result)? {
        compiled.failed = true;
    }

    for api in &result.apis {
        let Some(ir) = &api.ir else {
            continue;
        };
        let located = result
            .source_files
            .locations(&api.locations)
            .map_err(|error| InternalError::new(error.to_string()))?;

        compiled.apis.push(CompiledApi {
            source: name.to_owned(),
            api: api.api.clone(),
            ir: finalize_canonical_ir(ir)?,
            lint_input: Some(LintInput {
                declared: api.declared.clone().unwrap_or_default(),
                spans: api.locations.clone(),
                located,
            }),
        });
    }

    compiled
        .source_files
        .insert(name.to_owned(), result.source_files);

    Ok(())
}

/// The problem of a bundle failure at `location`; the failing file is named, quoted, when the
/// message does not already.
pub(crate) fn bundle_problem(failure: &BundleSourceFailure, location: &str) -> CliProblem {
    let file = match &failure.file {
        Some(file)
            if !failure.message.contains(file.as_str())
                && !failure.message.contains(&quote_text(file)) =>
        {
            format!(" (file {})", quote_text(file))
        }
        Some(_) | None => String::new(),
    };

    located_problem(
        failure.code.as_str(),
        format!("{}{file}", failure.message),
        &failure.fix,
        location.to_owned(),
    )
}

/// Prints a compiled source's diagnostics on stderr under the source's name; true when one is an
/// error.
///
/// # Errors
///
/// [`CliError::Internal`] when a side table entry points outside its file.
pub(crate) fn print_source_diagnostics(
    io: &mut dyn CliIo,
    name: &str,
    directory: &Utf8Path,
    result: &PipelineResult,
) -> Result<bool, CliError> {
    let files = &result.source_files;
    let mut printed = vec![printed_diagnostics(
        &result.diagnostics,
        &files
            .locations(&result.locations)
            .map_err(|error| InternalError::new(error.to_string()))?,
    )];

    for api in &result.apis {
        printed.push(printed_diagnostics(
            &api.diagnostics,
            &files
                .locations(&api.locations)
                .map_err(|error| InternalError::new(error.to_string()))?,
        ));
    }

    printed.retain(|text| !text.is_empty());

    if !printed.is_empty() {
        io.stderr(&format!(
            "In source '{name}' ({directory}):\n{}\n",
            printed.join("\n")
        ));
    }

    let has_error = result
        .diagnostics
        .iter()
        .chain(result.apis.iter().flat_map(|api| &api.diagnostics))
        .any(|diagnostic| diagnostic.severity == Severity::Error);

    Ok(has_error)
}

fn printed_diagnostics(
    diagnostics: &[Diagnostic],
    locations: &IndexMap<String, Location>,
) -> String {
    if diagnostics.is_empty() {
        return String::new();
    }

    print_diagnostics(diagnostics, locations)
}

#[cfg(test)]
mod tests {
    use seampact_bundle_fetch::BundleSourceFailureCode;

    use super::*;

    fn failure_in(file: &str, message: &str) -> BundleSourceFailure {
        BundleSourceFailure {
            file: Some(file.to_owned()),
            ..BundleSourceFailure::new(BundleSourceFailureCode::GitFailed, message.to_owned(), "f")
        }
    }

    #[test]
    fn a_failing_file_the_message_does_not_name_is_added_quoted_and_inert() {
        let problem = bundle_problem(
            &failure_in("sources/a\u{1b}[2Jb", "It failed."),
            "source 's'",
        );

        assert_eq!(problem.message, "It failed. (file 'sources/a\\u001B[2Jb')");
    }

    #[test]
    fn a_failing_file_the_message_quotes_is_not_added_again() {
        let problem = bundle_problem(
            &failure_in("sources/a\u{1b}b", "The file 'sources/a\\u001Bb' failed."),
            "source 's'",
        );

        assert_eq!(problem.message, "The file 'sources/a\\u001Bb' failed.");
    }
}
