//! The preparation of a run of generate or check: the config read, each app planned and
//! generated in memory, and every write checked before the first one.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_cli_config::{
    CliIo, CliProblem, LoadedAppConfig, LoadedWorkspace, Problems, ReadRunConfigOutcome,
    ResolvedSource, RunConfig, read_run_config, unlocated_problem,
};
use seampact_target::{CompatibilityMatrix, Registry};
use seampact_writer::HandEditPolicy;

use crate::app_plan::{AppPlan, plan_app};
use crate::document_emission::emit_app_documents;
use crate::drift_level::DEFAULT_DRIFT_CHECK_LEVEL;
use crate::entry_generation::generate_entries;
use crate::in_app::in_app;
use crate::merged_documents::emit_merged_documents;
use crate::stop::{Stop, gather};
use crate::write_plan::plan_writes;
use crate::{
    EmittedAppDocument, GenerateError, GeneratedOutput, LocalBundles, PlannedWrites, SweptDirectory,
};

/// The app or root config a run reads: its file, the name problems give it, and the file its
/// text is read from when a host hands it over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunConfigLocation<'run> {
    /// The config file.
    pub file: &'run Utf8Path,
    /// The name problems give it.
    pub display_name: &'run str,
    /// The file its text is read from, when it is not `file`.
    pub text_file: Option<&'run Utf8Path>,
}

/// What a run takes besides the config: the bundles its host already fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanInputs<'run> {
    /// The bundle directory of each source, never fetched.
    pub local_bundles: &'run LocalBundles,
}

/// An app of the run: its name in a root's `apps`, absent for a run of one app.
#[derive(Clone, Copy)]
struct RunApp<'run> {
    name: Option<&'run str>,
    config: &'run LoadedAppConfig,
}

/// An app with its plan.
struct PlannedApp<'run> {
    app: RunApp<'run>,
    plan: AppPlan<'run>,
}

/// What every app of the run shares.
struct RunOptions<'run> {
    io: &'run mut dyn CliIo,
    policy: HandEditPolicy,
    inputs: &'run PlanInputs<'run>,
    registry: &'run Registry,
    matrix: &'run CompatibilityMatrix,
}

/// Reads the config, plans and generates every app with the generators of `registry`, and checks
/// every write under `policy`; nothing is written.
///
/// # Errors
///
/// [`Stop::Refused`] with the problems of the config or the plan, [`Stop::Failed`] when a file
/// cannot be read, a step is not ported yet, or for a bug.
pub fn prepare_run(
    location: &RunConfigLocation<'_>,
    io: &mut dyn CliIo,
    policy: HandEditPolicy,
    inputs: &PlanInputs<'_>,
    registry: &Registry,
) -> Result<PlannedWrites, Stop> {
    let run = match read_run_config(location.file, location.display_name, location.text_file)? {
        ReadRunConfigOutcome::Refused(problems) => return Err(Problems::new(problems).into()),
        ReadRunConfigOutcome::Read(run) => run,
    };
    let configs: Vec<&LoadedAppConfig> = match &run {
        RunConfig::App(config) => vec![config],
        RunConfig::Root(workspace) => workspace.apps.iter().map(|each| &each.config).collect(),
    };
    let unknown_bundles = unknown_local_bundle_problems(&configs, *inputs);

    Problems::refuse_any(unknown_bundles)?;

    let matrix = CompatibilityMatrix::parse()?;
    let mut options = RunOptions {
        io,
        policy,
        inputs,
        registry,
        matrix: &matrix,
    };

    match &run {
        RunConfig::App(config) => {
            let app = RunApp { name: None, config };

            prepare_apps(&[app], None, &mut options)
        }
        RunConfig::Root(workspace) => {
            let apps: Vec<RunApp<'_>> = workspace
                .apps
                .iter()
                .map(|each| RunApp {
                    name: Some(each.app.name.as_str()),
                    config: &each.config,
                })
                .collect();

            prepare_apps(&apps, Some(workspace), &mut options)
        }
    }
}

fn unknown_local_bundle_problems(
    configs: &[&LoadedAppConfig],
    inputs: PlanInputs<'_>,
) -> Vec<CliProblem> {
    inputs
        .local_bundles
        .keys()
        .filter(|name| {
            !configs
                .iter()
                .any(|config| matches!(config.sources.get(*name), Some(ResolvedSource::Bundle(_))))
        })
        .map(|name| {
            unlocated_problem(
                "cli.bundle-directory.unknown-source",
                format!(
                    "`--bundle-directory` names the source '{name}', which is no bundle source of the app config."
                ),
                "Name a source the app config declares as a bundle (`release`, `git`, `package` or `maven`).",
            )
        })
        .collect()
}

fn prepare_apps(
    apps: &[RunApp<'_>],
    workspace: Option<&LoadedWorkspace>,
    run: &mut RunOptions<'_>,
) -> Result<PlannedWrites, Stop> {
    let plans = plan_each_app(apps, run)?;
    let mut outputs: Vec<GeneratedOutput> = Vec::new();
    let mut documents: Vec<EmittedAppDocument> = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();
    // A step can refuse with no problem to list: its diagnostics were already printed.
    let mut refused = false;

    for PlannedApp { app, plan } in &plans {
        let generated = gather_scoped(generate_entries(plan, app.name), app, &mut problems)?;
        let emitted = gather_scoped(
            emit_app_documents(
                &plan.documents,
                app.config
                    .checks
                    .openapi
                    .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL),
            ),
            app,
            &mut problems,
        )?;

        refused |= generated.is_none() || emitted.is_none();
        outputs.extend(generated.into_iter().flatten());
        documents.extend(emitted.into_iter().flatten());
    }

    if let Some(workspace) = workspace {
        let named_plans: IndexMap<&str, &AppPlan<'_>> = plans
            .iter()
            .filter_map(|planned| planned.app.name.map(|name| (name, &planned.plan)))
            .collect();

        let merged = gather(
            emit_merged_documents(workspace, &named_plans),
            &mut problems,
        )?;

        refused |= merged.is_none();
        documents.extend(merged.into_iter().flatten());
    }

    if refused {
        return Err(Problems::new(problems).into());
    }

    let mut swept: Vec<SweptDirectory> = plans
        .iter()
        .map(|planned| SweptDirectory {
            directory: planned.plan.default_document_directory.clone(),
            level: planned
                .app
                .config
                .checks
                .openapi
                .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL),
        })
        .collect();

    // A merged document dropped from the root's `openapi` leaves its file in the root's directory.
    if let Some(workspace) = workspace
        && let Some(directory) = workspace.root.file.parent()
    {
        swept.push(SweptDirectory {
            directory: directory.to_owned(),
            level: workspace
                .root
                .checks_settings()?
                .openapi
                .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL),
        });
    }

    Ok(plan_writes(&outputs, &documents, &swept, run.policy)?)
}

fn plan_each_app<'run>(
    apps: &[RunApp<'run>],
    run: &mut RunOptions<'_>,
) -> Result<Vec<PlannedApp<'run>>, Stop> {
    let mut planned = Vec::new();
    let mut problems = Vec::new();
    let mut refused = false;

    for app in apps {
        let step = plan_app(
            app.config,
            &mut *run.io,
            run.inputs,
            run.registry,
            run.matrix,
        );

        match gather_scoped(step, app, &mut problems)? {
            Some(plan) => planned.push(PlannedApp { app: *app, plan }),
            None => refused = true,
        }
    }

    if refused {
        return Err(Problems::new(problems).into());
    }

    Ok(planned)
}

/// As [`gather`], with the refusals of an app of a root named after the app.
fn gather_scoped<Value>(
    step: Result<Value, Stop>,
    app: &RunApp<'_>,
    problems: &mut Vec<CliProblem>,
) -> Result<Option<Value>, GenerateError> {
    let mut refused = Vec::new();
    let value = gather(step, &mut refused)?;

    problems.extend(scoped(app, refused));

    Ok(value)
}

fn scoped(app: &RunApp<'_>, problems: Vec<CliProblem>) -> Vec<CliProblem> {
    match app.name {
        None => problems,
        Some(name) => problems
            .into_iter()
            .map(|problem| in_app(name, problem))
            .collect(),
    }
}
