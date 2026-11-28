//! The plan of one app: its entries resolved, ordered and checked against each other, its apis
//! compiled and filtered, its documents planned; nothing is generated yet.

use camino::Utf8PathBuf;
use seampact_cli_config::{
    CliIo, CliProblem, ConfiguredTargetEntry, EntryTarget, InstalledPackageRole,
    InstalledVersionOutcome, LoadedAppConfig, Problems, TargetEntrySettings,
    check_app_compatibility, default_document_directory, entry_where, located_problem,
    open_api_api_names, print_warnings, read_installed_version, select_artefacts,
};
use seampact_target::{
    CompatibilityMatrix, InstalledRuntimes, Registry, TargetMetadata, resolve_link_needs,
};

use crate::api_refs::{
    add_qualify_fix, entry_api_refs, resolve_entry_apis, sources_holding_refs,
    unknown_source_problems,
};
use crate::compile_sources::{CompiledApi, compile_sources};
use crate::entry_links::{
    order_entries, pairing_problems, unconsumed_kind_problems, unknown_link_entry_problems,
    unprovided_kind_problems,
};
use crate::filter_operations::{OperationSelection, filter_operations};
use crate::framework_docs::framework_docs_problems;
use crate::framework_route_check::unread_framework_route_key_problems;
use crate::planned_document::{PlannedDocument, plan_documents};
use crate::planned_entry::{PlannedApi, PlannedEntry};
use crate::stop::Stop;
use crate::{GenerateError, PlanInputs};

/// What one app generates, planned and checked in memory.
#[derive(Debug, Clone)]
pub struct AppPlan<'run> {
    /// The app's config.
    pub config: &'run LoadedAppConfig,
    /// The entries, each after the providers it links.
    pub entries: Vec<PlannedEntry>,
    /// The documents the app writes.
    pub documents: Vec<PlannedDocument>,
    /// Where documents go that `openapi` gives no file.
    pub default_document_directory: Utf8PathBuf,
    /// Every api the app read.
    pub compiled: Vec<CompiledApi>,
}

/// Plans one app: its targets, links, artefacts, compatibility, apis, operations and documents,
/// in this order, stopping at the first group of problems.
///
/// # Errors
///
/// [`Stop::Refused`] with the first group of problems, [`Stop::Failed`] when a source cannot be
/// read, a step is not ported yet, or for a bug.
pub fn plan_app<'run>(
    config: &'run LoadedAppConfig,
    io: &mut dyn CliIo,
    inputs: &PlanInputs<'_>,
    registry: &Registry,
    matrix: &CompatibilityMatrix,
) -> Result<AppPlan<'run>, Stop> {
    let settings: Vec<&TargetEntrySettings> =
        config.entries.iter().map(|each| &each.settings).collect();

    Problems::refuse_any(unknown_link_entry_problems(&settings))?;

    let link_order: Vec<&str> = order_entries(&settings)?
        .into_iter()
        .map(|entry| entry.id.as_str())
        .collect();
    let targets = resolve_targets(&config.entries, registry)?;
    let (mut planned, mut config_problems) = select_entry_artefacts(&targets, matrix)?;
    let compatibility =
        check_app_compatibility(&targets, config.checks.matrix.unwrap_or_default(), matrix)?;

    print_warnings(io, &compatibility.warnings);
    config_problems.extend(compatibility.problems);
    Problems::refuse_any(config_problems)?;
    Problems::refuse_any(unknown_source_problems(config))?;

    let mut refs = entry_api_refs(config);

    refs.extend(open_api_api_names(config));

    let source_names = sources_holding_refs(config, &refs);
    let compiled = compile_sources(config, &source_names, inputs.local_bundles, io)?;

    if compiled.failed {
        return Err(Problems::new(add_qualify_fix(compiled.problems, &refs)).into());
    }

    plan_each_entry(&mut planned, &compiled.apis)?;

    let mut link_problems = unprovided_kind_problems(&planned);

    link_problems.extend(unconsumed_kind_problems(&planned));
    link_problems.extend(pairing_problems(&planned));
    Problems::refuse_any(link_problems)?;

    let documents = plan_documents(config, &planned, &compiled.apis)?;

    planned.sort_by_key(|entry| link_order.iter().position(|id| *id == entry.settings.id));

    Ok(AppPlan {
        config,
        entries: planned,
        documents,
        default_document_directory: default_document_directory(config),
        compiled: compiled.apis,
    })
}

/// Each entry with the artefacts its switches select, its needs read and its runtime packages
/// looked up, in config order, and the problems of the entries whose switches the target refuses.
fn select_entry_artefacts(
    targets: &[EntryTarget<'_>],
    matrix: &CompatibilityMatrix,
) -> Result<(Vec<PlannedEntry>, Vec<CliProblem>), Stop> {
    let mut planned = Vec::with_capacity(targets.len());
    let mut problems = Vec::new();

    for each in targets {
        match select_artefacts(&each.entry.settings, each.target) {
            Ok(artefacts) => {
                let metadata = each.target.metadata();
                let needs = resolve_link_needs(&metadata.consumes, metadata.compatibility, matrix)
                    .map_err(GenerateError::from)?;
                let installed_runtimes = installed_runtimes_of(each.entry, metadata)?;

                planned.push(PlannedEntry::resolved(
                    each.entry,
                    each.target,
                    artefacts,
                    needs,
                    installed_runtimes,
                ));
            }
            Err(refused) => problems.extend(refused),
        }
    }

    Ok((planned, problems))
}

/// The version of each runtime package of the target installed from the entry's output
/// directory upward; a package that is not installed or not readable is recorded as absent.
fn installed_runtimes_of(
    entry: &ConfiguredTargetEntry,
    metadata: &TargetMetadata,
) -> Result<InstalledRuntimes, GenerateError> {
    let mut runtimes = InstalledRuntimes::default();
    let location = entry_where(&entry.settings.id, None);

    for package in metadata.runtime_packages {
        let outcome = read_installed_version(
            &entry.root,
            package,
            InstalledPackageRole::Library,
            &location,
        )?;
        let version = match outcome {
            InstalledVersionOutcome::Installed(installed) => Some(installed.version),
            InstalledVersionOutcome::Refused(_) => None,
        };

        runtimes.insert((*package).to_owned(), version);
    }

    Ok(runtimes)
}

fn resolve_targets<'config>(
    entries: &'config [ConfiguredTargetEntry],
    registry: &Registry,
) -> Result<Vec<EntryTarget<'config>>, Problems> {
    let mut targets = Vec::with_capacity(entries.len());
    let mut problems = Vec::new();

    for entry in entries {
        let settings = &entry.settings;

        match registry.lookup(&settings.use_name) {
            Ok(target) => targets.push(EntryTarget { entry, target }),
            Err(problem) => problems.push(located_problem(
                problem.code.as_str(),
                problem.message,
                &problem.fix,
                entry_where(&settings.id, None),
            )),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(targets)
}

fn plan_each_entry(planned: &mut [PlannedEntry], compiled: &[CompiledApi]) -> Result<(), Problems> {
    let mut problems = Vec::new();

    for entry in planned {
        problems.extend(unread_framework_route_key_problems(
            &entry.settings,
            entry.target,
        ));
        problems.extend(framework_docs_problems(&entry.settings, entry.target));

        match plan_entry_apis(entry, compiled) {
            Ok(apis) => entry.apis = apis,
            Err(refused) => problems.extend(refused),
        }
    }

    Problems::refuse_any(problems)
}

fn plan_entry_apis(
    entry: &PlannedEntry,
    compiled: &[CompiledApi],
) -> Result<Vec<PlannedApi>, Problems> {
    let settings = &entry.settings;
    let resolved = resolve_entry_apis(settings, compiled)?;
    let selection = OperationSelection {
        document: settings.document.as_deref(),
        operations: settings.operations.as_ref(),
    };
    let mut apis = Vec::new();
    let mut problems = Vec::new();

    for each in resolved {
        match filter_operations(&each.ir, &selection) {
            Err(refused) => {
                let location = entry_where(&settings.id, Some(&each.api));

                problems.extend(refused.into_iter().map(|problem| CliProblem {
                    location: Some(location.clone()),
                    ..problem
                }));
            }
            Ok(ir) => apis.push(PlannedApi {
                api: each.api.clone(),
                source: each.source.clone(),
                ir,
                root: if settings.apis.is_none() {
                    entry.root.clone()
                } else {
                    entry.root.join(&each.api)
                },
                located: each.lint_input.as_ref().map(|input| input.located.clone()),
            }),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(apis)
}
