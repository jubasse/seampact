//! The recorded calls of the CLI config readers: the brief that ports each recorded function reads
//! its arguments and converts its result here.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle::{BundleSource, BundleSourceForm};
use seampact_cli_config::{
    CliConfigError, CliProblem, LoadedAppConfig, LoadedMergedDocument, LoadedRootConfig,
    LoadedWorkspace, ReadAppConfigOutcome, ReadRootConfigOutcome, ReadRunConfigOutcome,
    ReadWorkspaceOutcome, ResolvedSource, RunConfig, WorkspaceApp, read_app_config,
    read_root_config, read_run_config, read_workspace_configs,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};

use crate::oracle::stub_answer::{StubError, failed_answer};

impl StubError for CliConfigError {
    fn is_not_ported(&self) -> bool {
        match self {
            Self::Internal(_) | Self::Io { .. } => false,
        }
    }
}

/// Replays a recorded call of the CLI config readers on the case root.
pub(super) fn cli_config_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    match call.function.as_str() {
        "readAppConfig" => read_app_config_answer(call, root),
        "readRootConfig" => read_root_config_answer(call, root),
        "readWorkspaceConfigs" => read_workspace_configs_answer(call, root),
        "readRunConfig" => read_run_config_answer(call, root),
        _ => SubjectAnswer::NotPorted,
    }
}

fn read_root_config_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let Some((file, display_name)) = file_and_display_name(call, root) else {
        return malformed_call(call);
    };

    match read_root_config(&file, &display_name) {
        Ok(ReadRootConfigOutcome::Read(config)) => {
            answer(read_json("config", loaded_root_config_json(&config)))
        }
        Ok(ReadRootConfigOutcome::Refused(problems)) => answer(refused_json(&problems)),
        Err(error) => failed_answer(&error),
    }
}

fn read_workspace_configs_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let Some((file, display_name)) = file_and_display_name(call, root) else {
        return malformed_call(call);
    };

    match read_workspace_configs(&file, &display_name) {
        Ok(ReadWorkspaceOutcome::Read(workspace)) => {
            answer(read_json("workspace", loaded_workspace_json(&workspace)))
        }
        Ok(ReadWorkspaceOutcome::Refused(problems)) => answer(refused_json(&problems)),
        Err(error) => failed_answer(&error),
    }
}

fn read_run_config_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let Some((file, display_name)) = file_and_display_name(call, root) else {
        return malformed_call(call);
    };
    let text_file = path_argument(call, 2, root);

    match read_run_config(&file, &display_name, text_file.as_deref()) {
        Ok(ReadRunConfigOutcome::Read(run)) => answer(read_json("run", run_config_json(&run))),
        Ok(ReadRunConfigOutcome::Refused(problems)) => answer(refused_json(&problems)),
        Err(error) => failed_answer(&error),
    }
}

fn file_and_display_name(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> Option<(Utf8PathBuf, String)> {
    Some((path_argument(call, 0, root)?, text_argument(call, 1, root)?))
}

fn answer(result: JsonValue) -> SubjectAnswer<RecordedAnswer> {
    SubjectAnswer::Ported(RecordedAnswer {
        result,
        written: IndexMap::new(),
    })
}

fn read_json(member: &'static str, value: JsonValue) -> JsonValue {
    object([("status", text("read")), (member, value)])
}

fn refused_json(problems: &[CliProblem]) -> JsonValue {
    object([
        ("status", text("refused")),
        (
            "problems",
            JsonValue::Array(problems.iter().map(problem_json).collect()),
        ),
    ])
}

fn run_config_json(run: &RunConfig) -> JsonValue {
    match run {
        RunConfig::App(config) => object([
            ("kind", text("app")),
            ("config", loaded_app_config_json(config)),
        ]),
        RunConfig::Root(workspace) => object([
            ("kind", text("root")),
            ("workspace", loaded_workspace_json(workspace)),
        ]),
    }
}

fn loaded_workspace_json(workspace: &LoadedWorkspace) -> JsonValue {
    object([
        ("root", loaded_root_config_json(&workspace.root)),
        (
            "apps",
            JsonValue::Array(
                workspace
                    .apps
                    .iter()
                    .map(|each| {
                        object([
                            ("app", workspace_app_json(&each.app)),
                            ("config", loaded_app_config_json(&each.config)),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

fn workspace_app_json(app: &WorkspaceApp) -> JsonValue {
    object([
        ("name", text(&app.name)),
        ("directory", text(app.directory.as_str())),
        ("file", text(app.file.as_str())),
    ])
}

fn loaded_root_config_json(config: &LoadedRootConfig) -> JsonValue {
    let mut members = vec![
        ("file", text(config.file.as_str())),
        ("displayName", text(&config.display_name)),
        (
            "apps",
            JsonValue::Array(config.apps.iter().map(workspace_app_json).collect()),
        ),
        ("sources", sources_json(&config.sources)),
    ];

    if let Some(allow_local) = config.allow_local {
        members.push(("allowLocal", JsonValue::Bool(allow_local)));
    }

    members.push((
        "openapi",
        JsonValue::Array(config.openapi.iter().map(merged_document_json).collect()),
    ));
    members.push(("checks", config.checks.clone()));

    object(members)
}

fn merged_document_json(document: &LoadedMergedDocument) -> JsonValue {
    object([
        ("name", text(&document.name)),
        ("file", text(document.file.as_str())),
        (
            "apps",
            JsonValue::Array(document.apps.iter().map(|name| text(name)).collect()),
        ),
        ("prefix", document.prefix.clone()),
        ("options", document.options.clone()),
    ])
}

fn read_app_config_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let Some(file) = path_argument(call, 0, root) else {
        return malformed_call(call);
    };
    let Some(display_name) = text_argument(call, 1, root) else {
        return malformed_call(call);
    };
    let text_file = path_argument(call, 2, root);

    match read_app_config(&file, &display_name, text_file.as_deref()) {
        Ok(outcome) => SubjectAnswer::Ported(RecordedAnswer {
            result: app_outcome_json(&outcome),
            written: IndexMap::new(),
        }),
        Err(error) => failed_answer(&error),
    }
}

fn malformed_call(call: &RecordedToolCall) -> SubjectAnswer<RecordedAnswer> {
    SubjectAnswer::InternalError {
        message: format!(
            "a recorded {} call without its path arguments",
            call.function
        ),
    }
}

fn text_argument(call: &RecordedToolCall, position: usize, root: &Utf8Path) -> Option<String> {
    match call.args.get(position)? {
        JsonValue::String(text) => Some(text.replace(ROOT_TOKEN, root.as_str())),
        _ => None,
    }
}

fn path_argument(call: &RecordedToolCall, position: usize, root: &Utf8Path) -> Option<Utf8PathBuf> {
    text_argument(call, position, root).map(Utf8PathBuf::from)
}

fn app_outcome_json(outcome: &ReadAppConfigOutcome) -> JsonValue {
    match outcome {
        ReadAppConfigOutcome::Read(config) => object([
            ("status", text("read")),
            ("config", loaded_app_config_json(config)),
        ]),
        ReadAppConfigOutcome::Refused(problems) => object([
            ("status", text("refused")),
            (
                "problems",
                JsonValue::Array(problems.iter().map(problem_json).collect()),
            ),
        ]),
    }
}

fn loaded_app_config_json(config: &LoadedAppConfig) -> JsonValue {
    let mut members = vec![
        ("file", text(config.file.as_str())),
        ("outDir", text(config.out_dir.as_str())),
    ];

    if let Some(allow_local) = config.allow_local {
        members.push(("allowLocal", JsonValue::Bool(allow_local)));
    }

    members.push(("sources", sources_json(&config.sources)));
    members.push((
        "entries",
        JsonValue::Array(
            config
                .entries
                .iter()
                .map(|each| {
                    object([
                        ("entry", each.entry.clone()),
                        ("root", text(each.root.as_str())),
                    ])
                })
                .collect(),
        ),
    ));

    for (name, value) in [
        ("openapi", &config.openapi),
        ("checks", &config.checks),
        ("diff", &config.diff),
        ("warnings", &config.warnings),
    ] {
        if let Some(value) = value {
            members.push((name, value.clone()));
        }
    }

    if let Some(root_file) = &config.root_file {
        members.push(("rootFile", text(root_file.as_str())));
    }

    object(members)
}

fn sources_json(sources: &IndexMap<String, ResolvedSource>) -> JsonValue {
    JsonValue::Object(
        sources
            .iter()
            .map(|(name, source)| {
                let json = match source {
                    ResolvedSource::Path { directory } => object([
                        ("kind", text("path")),
                        ("directory", text(directory.as_str())),
                    ]),
                    ResolvedSource::Bundle(bundle) => {
                        object([("kind", text("bundle")), ("bundle", bundle_json(bundle))])
                    }
                };

                (name.clone(), json)
            })
            .collect(),
    )
}

/// The bundle source as the config writes it.
fn bundle_json(bundle: &BundleSource) -> JsonValue {
    let mut members = match &bundle.form {
        BundleSourceForm::Package(package) => vec![
            ("package", text(&package.package)),
            ("version", text(&package.version)),
        ],
        BundleSourceForm::Release(release) => {
            vec![("release", object([("url", text(&release.url))]))]
        }
        BundleSourceForm::Git(git) => {
            let mut git_members = vec![("url", text(&git.url)), ("tag", text(&git.tag))];

            if let Some(directory) = &git.directory {
                git_members.push(("directory", text(directory)));
            }

            vec![("git", object(git_members))]
        }
        BundleSourceForm::Maven(coordinate) => vec![("maven", text(coordinate))],
    };

    if let Some(integrity) = &bundle.integrity {
        members.push(("integrity", text(integrity)));
    }

    object(members)
}

fn problem_json(problem: &CliProblem) -> JsonValue {
    let mut members = vec![
        ("code", text(&problem.code)),
        ("message", text(&problem.message)),
        ("fix", text(&problem.fix)),
    ];

    if let Some(location) = &problem.location {
        members.push(("where", text(location)));
    }

    object(members)
}

fn text(value: &str) -> JsonValue {
    JsonValue::String(value.to_owned())
}

fn object(members: impl IntoIterator<Item = (&'static str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        members
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect::<JsonObject>(),
    )
}
