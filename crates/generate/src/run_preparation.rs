//! The preparation of a run of generate or check: the config read, each app planned and
//! generated in memory, and every write checked before the first one.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_cli_config::{
    CheckLevel, CliIo, CliProblem, LoadedAppConfig, LoadedWorkspace, ReadRunConfigOutcome,
    ResolvedSource, RunConfig, Step, read_run_config, unlocated_problem,
};
use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, object_of, text_of};
use seampact_target::{CompatibilityMatrix, Registry};
use seampact_writer::HandEditPolicy;

use crate::app_plan::{AppPlan, plan_app};
use crate::document_emission::emit_app_documents;
use crate::drift_level::DEFAULT_DRIFT_CHECK_LEVEL;
use crate::entry_generation::generate_entries;
use crate::in_app::in_app;
use crate::merged_documents::emit_merged_documents;
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
/// [`GenerateError`] when a file cannot be read, a step is not ported yet, or for a bug.
pub fn prepare_run(
    location: &RunConfigLocation<'_>,
    io: &mut dyn CliIo,
    policy: HandEditPolicy,
    inputs: &PlanInputs<'_>,
    registry: &Registry,
) -> Result<Step<PlannedWrites>, GenerateError> {
    let run = match read_run_config(location.file, location.display_name, location.text_file)? {
        ReadRunConfigOutcome::Refused(problems) => return Ok(Step::Refused(problems)),
        ReadRunConfigOutcome::Read(run) => run,
    };
    let configs: Vec<&LoadedAppConfig> = match &run {
        RunConfig::App(config) => vec![config],
        RunConfig::Root(workspace) => workspace.apps.iter().map(|each| &each.config).collect(),
    };
    let unknown_bundles = unknown_local_bundle_problems(&configs, *inputs);

    if !unknown_bundles.is_empty() {
        return Ok(Step::Refused(unknown_bundles));
    }

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
) -> Result<Step<PlannedWrites>, GenerateError> {
    let plans = match plan_each_app(apps, run)? {
        Step::Refused(problems) => return Ok(Step::Refused(problems)),
        Step::Done(plans) => plans,
    };
    let mut outputs: Vec<GeneratedOutput> = Vec::new();
    let mut documents: Vec<EmittedAppDocument> = Vec::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for PlannedApp { app, plan } in &plans {
        let generated = generate_entries(plan, app.name)?;
        let emitted = emit_app_documents(&plan.documents, openapi_level(app.config)?)?;

        match generated {
            Step::Refused(refused) => problems.extend(scoped(app, refused)),
            Step::Done(done) => outputs.extend(done),
        }

        match emitted {
            Step::Refused(refused) => problems.extend(scoped(app, refused)),
            Step::Done(done) => documents.extend(done),
        }
    }

    if let Some(workspace) = workspace {
        let named_plans: IndexMap<&str, &AppPlan<'_>> = plans
            .iter()
            .filter_map(|planned| planned.app.name.map(|name| (name, &planned.plan)))
            .collect();

        match emit_merged_documents(workspace, &named_plans)? {
            Step::Refused(refused) => problems.extend(refused),
            Step::Done(done) => documents.extend(done),
        }
    }

    if !problems.is_empty() {
        return Ok(Step::Refused(problems));
    }

    let mut swept: Vec<SweptDirectory> = Vec::new();

    for planned in &plans {
        swept.push(SweptDirectory {
            directory: planned.plan.default_document_directory.clone(),
            level: openapi_level(planned.app.config)?,
        });
    }

    // A merged document dropped from the root's `openapi` leaves its file in the root's directory.
    if let Some(workspace) = workspace
        && let Some(directory) = workspace.root.file.parent()
    {
        swept.push(SweptDirectory {
            directory: directory.to_owned(),
            level: root_openapi_level(&workspace.root.checks)?,
        });
    }

    let writes = plan_writes(&outputs, &documents, &swept, run.policy)?;

    Ok(Step::Done(writes))
}

fn openapi_level(config: &LoadedAppConfig) -> Result<CheckLevel, InternalError> {
    Ok(config
        .checks()?
        .openapi
        .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL))
}

fn root_openapi_level(checks: &JsonValue) -> Result<CheckLevel, InternalError> {
    let Some(written) = object_of(Some(checks)).and_then(|object| object.get("openapi")) else {
        return Ok(DEFAULT_DRIFT_CHECK_LEVEL);
    };

    [CheckLevel::Disabled, CheckLevel::Warning, CheckLevel::Error]
        .into_iter()
        .find(|level| text_of(Some(written)) == Some(level.as_str()))
        .ok_or_else(|| InternalError::new("the root's checks.openapi is no check level"))
}

fn plan_each_app<'run>(
    apps: &[RunApp<'run>],
    run: &mut RunOptions<'_>,
) -> Result<Step<Vec<PlannedApp<'run>>>, GenerateError> {
    let mut planned = Vec::new();
    let mut problems = Vec::new();
    let mut any_refused = false;

    for app in apps {
        match plan_app(
            app.config,
            &mut *run.io,
            run.inputs,
            run.registry,
            run.matrix,
        )? {
            Step::Refused(refused) => {
                any_refused = true;
                problems.extend(scoped(app, refused));
            }
            Step::Done(plan) => planned.push(PlannedApp { app: *app, plan }),
        }
    }

    if any_refused {
        Ok(Step::Refused(problems))
    } else {
        Ok(Step::Done(planned))
    }
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
