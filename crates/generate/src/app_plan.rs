//! The plan of one app: its entries resolved, ordered and checked against each other, its apis
//! compiled and filtered, its documents planned; nothing is generated yet.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::{
    AppConfigEntry, ArtefactSelection, CliIo, CliProblem, ConfiguredTargetEntry, LoadedAppConfig,
    Step, check_app_compatibility, default_document_directory, entry_where, located_problem,
    open_api_api_names, print_warnings, select_artefacts,
};
use seampact_diagnostics::InternalError;
use seampact_target::{ArtefactSet, CompatibilityMatrix, Generator, Registry, TargetRole};

use crate::GenerateError;
use crate::PlanInputs;
use crate::api_refs::{
    EntryApisOutcome, add_qualify_fix, entry_api_refs, resolve_entry_apis, sources_holding_refs,
    unknown_source_problems,
};
use crate::compile_sources::{CompiledApi, compile_sources};
use crate::entry_links::{
    EntryOrderOutcome, order_entries, pairing_problems, unconsumed_kind_problems,
    unknown_link_entry_problems, unprovided_kind_problems,
};
use crate::filter_operations::{FilterOutcome, OperationSelection, filter_operations};
use crate::framework_docs::framework_docs_problems;
use crate::framework_route_check::unread_framework_route_key_problems;
use crate::planned_document::{PlannedDocument, plan_documents};
use crate::planned_entry::{PlannedApi, PlannedEntry, planned_entry};

/// The generator each entry's `use` names, by entry id.
pub(crate) type Targets = IndexMap<String, &'static dyn Generator>;

/// What one app generates, planned and checked in memory.
#[derive(Debug, Clone)]
pub struct AppPlan<'run> {
    /// The app's config.
    pub config: &'run LoadedAppConfig,
    /// The entries, each after the providers it links.
    pub entries: Vec<PlannedEntry>,
    /// The artefacts each entry switches on, by entry id.
    pub artefacts: IndexMap<String, ArtefactSet>,
    /// The documents the app writes.
    pub documents: Vec<PlannedDocument>,
    /// Where documents go that `openapi` gives no file.
    pub default_document_directory: Utf8PathBuf,
    /// Every api the app read.
    pub compiled: Vec<CompiledApi>,
    /// The role of each entry's target, by entry id.
    pub roles: IndexMap<String, TargetRole>,
}

/// Plans one app: its targets, links, artefacts, compatibility, apis, operations and documents,
/// in this order, stopping at the first group of problems.
///
/// # Errors
///
/// [`GenerateError`] when a source cannot be read, a step is not ported yet, or for a bug.
pub fn plan_app<'run>(
    config: &'run LoadedAppConfig,
    io: &mut dyn CliIo,
    inputs: &PlanInputs<'_>,
    registry: &Registry,
    matrix: &CompatibilityMatrix,
) -> Result<Step<AppPlan<'run>>, GenerateError> {
    let entries = config.target_entries()?;
    let settings: Vec<_> = entries.iter().map(|each| &each.settings).collect();
    let unknown_links = unknown_link_entry_problems(&settings);

    if !unknown_links.is_empty() {
        return Ok(Step::Refused(unknown_links));
    }

    let order = match order_entries(&settings) {
        EntryOrderOutcome::Refused(problems) => return Ok(Step::Refused(problems)),
        EntryOrderOutcome::Ordered(ordered) => ordered
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>(),
    };
    let targets = match resolve_targets(&entries, registry) {
        Step::Refused(problems) => return Ok(Step::Refused(problems)),
        Step::Done(targets) => targets,
    };
    let artefacts = select_entry_artefacts(&entries, &targets)?;
    let compatibility = check_app_compatibility(config, &targets, matrix)?;

    print_warnings(io, &compatibility.warnings);

    let (selected, mut config_problems) = match artefacts {
        Step::Done(selected) => (Some(selected), Vec::new()),
        Step::Refused(problems) => (None, problems),
    };

    config_problems.extend(compatibility.problems);

    let Some(selected) = selected.filter(|_| config_problems.is_empty()) else {
        return Ok(Step::Refused(config_problems));
    };

    let unknown_sources = unknown_source_problems(config)?;

    if !unknown_sources.is_empty() {
        return Ok(Step::Refused(unknown_sources));
    }

    let mut ref_names: Vec<String> = entry_api_refs(config)
        .into_iter()
        .map(str::to_owned)
        .collect();

    ref_names.extend(open_api_api_names(config)?);

    let refs: Vec<&str> = ref_names.iter().map(String::as_str).collect();
    let source_names = sources_holding_refs(config, &refs);
    let compiled = compile_sources(config, &source_names, inputs.local_bundles, io)?;

    if compiled.failed {
        return Ok(Step::Refused(add_qualify_fix(compiled.problems, &refs)));
    }

    let mut planned = match plan_each_entry(config, &entries, &targets, &compiled.apis)? {
        Step::Refused(problems) => return Ok(Step::Refused(problems)),
        Step::Done(planned) => planned,
    };
    let mut link_problems = unprovided_kind_problems(&planned);

    link_problems.extend(unconsumed_kind_problems(&planned));
    link_problems.extend(pairing_problems(&planned));

    if !link_problems.is_empty() {
        return Ok(Step::Refused(link_problems));
    }

    let roles: IndexMap<String, TargetRole> = targets
        .iter()
        .map(|(entry_id, target)| (entry_id.clone(), target.metadata().role))
        .collect();
    let documents = match plan_documents(config, &roles, &compiled.apis)? {
        Step::Refused(problems) => return Ok(Step::Refused(problems)),
        Step::Done(documents) => documents,
    };
    let ordered: Result<Vec<PlannedEntry>, InternalError> = order
        .iter()
        .map(|entry_id| planned_entry(&mut planned, entry_id))
        .collect();

    Ok(Step::Done(AppPlan {
        config,
        entries: ordered?,
        artefacts: selected,
        documents,
        default_document_directory: default_document_directory(config),
        compiled: compiled.apis,
        roles,
    }))
}

fn select_entry_artefacts(
    entries: &[ConfiguredTargetEntry],
    targets: &Targets,
) -> Result<Step<IndexMap<String, ArtefactSet>>, GenerateError> {
    let mut selected = IndexMap::new();
    let mut problems = Vec::new();

    for entry in entries {
        let settings = &entry.settings;
        let target = targets
            .get(&settings.id)
            .ok_or_else(|| missing_target(&settings.id))?;

        match select_artefacts(settings, *target)? {
            ArtefactSelection::Refused(refused) => problems.extend(refused),
            ArtefactSelection::Selected(artefacts) => {
                selected.insert(settings.id.clone(), artefacts);
            }
        }
    }

    if problems.is_empty() {
        Ok(Step::Done(selected))
    } else {
        Ok(Step::Refused(problems))
    }
}

fn missing_target(entry_id: &str) -> InternalError {
    InternalError::new(format!("no resolved target for the entry {entry_id}"))
}

fn resolve_targets(entries: &[ConfiguredTargetEntry], registry: &Registry) -> Step<Targets> {
    let mut targets = Targets::new();
    let mut problems = Vec::new();

    for entry in entries {
        let settings = &entry.settings;

        match registry.lookup(&settings.use_name) {
            Ok(target) => {
                targets.insert(settings.id.clone(), target);
            }
            Err(problem) => problems.push(located_problem(
                problem.code.as_str(),
                problem.message,
                &problem.fix,
                entry_where(&settings.id, None),
            )),
        }
    }

    if problems.is_empty() {
        Step::Done(targets)
    } else {
        Step::Refused(problems)
    }
}

fn plan_each_entry(
    config: &LoadedAppConfig,
    entries: &[ConfiguredTargetEntry],
    targets: &Targets,
    compiled: &[CompiledApi],
) -> Result<Step<IndexMap<String, PlannedEntry>>, GenerateError> {
    let mut planned = IndexMap::new();
    let mut problems = Vec::new();

    for (written, entry) in config.entries.iter().zip(entries) {
        let settings = &entry.settings;
        let target = *targets
            .get(&settings.id)
            .ok_or_else(|| missing_target(&settings.id))?;

        problems.extend(unread_framework_route_key_problems(settings, target));
        problems.extend(framework_docs_problems(settings, target));

        match plan_entry_apis(entry, written, compiled) {
            Step::Refused(refused) => problems.extend(refused),
            Step::Done(apis) => {
                planned.insert(
                    settings.id.clone(),
                    PlannedEntry {
                        entry: entry.clone(),
                        target,
                        apis,
                    },
                );
            }
        }
    }

    if problems.is_empty() {
        Ok(Step::Done(planned))
    } else {
        Ok(Step::Refused(problems))
    }
}

fn plan_entry_apis(
    entry: &ConfiguredTargetEntry,
    written: &AppConfigEntry,
    compiled: &[CompiledApi],
) -> Step<Vec<PlannedApi>> {
    let settings = &entry.settings;
    let resolved = match resolve_entry_apis(&settings.id, &written.entry, compiled) {
        EntryApisOutcome::Refused(problems) => return Step::Refused(problems),
        EntryApisOutcome::Resolved(resolved) => resolved,
    };
    let selection = OperationSelection {
        document: settings.document.as_deref(),
        operations: settings.operations.as_ref(),
    };
    let mut apis = Vec::new();
    let mut problems = Vec::new();

    for each in resolved {
        match filter_operations(&each.ir, &selection) {
            FilterOutcome::Refused(refused) => {
                let location = entry_where(&settings.id, Some(&each.api));

                problems.extend(refused.into_iter().map(|problem| CliProblem {
                    location: Some(location.clone()),
                    ..problem
                }));
            }
            FilterOutcome::Filtered(ir) => apis.push(PlannedApi {
                api: each.api.clone(),
                source: each.source.clone(),
                ir: *ir,
                root: if settings.apis.is_none() {
                    entry.root.clone()
                } else {
                    entry.root.join(&each.api)
                },
                located: each.lint_input.as_ref().map(|input| input.located.clone()),
            }),
        }
    }

    if problems.is_empty() {
        Step::Done(apis)
    } else {
        Step::Refused(problems)
    }
}
