//! The recorded calls of the CLI config readers: the brief that ports each recorded function reads
//! its arguments and converts its result here.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle_source::{BundleSource, BundleSourceForm};
use seampact_cli_config::{
    CliConfigError, CliProblem, LoadedAppConfig, LoadedMergedDocument, LoadedRootConfig,
    LoadedWorkspace, ReadAppConfigOutcome, ReadRootConfigOutcome, ReadRunConfigOutcome,
    ReadWorkspaceOutcome, ResolvedSource, RunConfig, WorkspaceApp, read_app_config,
    read_root_config, read_run_config, read_workspace_configs,
};
use seampact_json::JsonValue;
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};

use crate::oracle::json::{array_of, coded_problem_json, push_present_texts};
use crate::oracle::stub_answer::{StubError, failed_answer};

impl StubError for CliConfigError {
    fn is_not_ported(&self) -> bool {
        match self {
            Self::NotPortedYet { .. } => true,
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
    JsonValue::object([("status", JsonValue::text("read")), (member, value)])
}

fn refused_json(problems: &[CliProblem]) -> JsonValue {
    JsonValue::object([
        ("status", JsonValue::text("refused")),
        ("problems", array_of(problems, problem_json)),
    ])
}

fn run_config_json(run: &RunConfig) -> JsonValue {
    match run {
        RunConfig::App(config) => JsonValue::object([
            ("kind", JsonValue::text("app")),
            ("config", loaded_app_config_json(config)),
        ]),
        RunConfig::Root(workspace) => JsonValue::object([
            ("kind", JsonValue::text("root")),
            ("workspace", loaded_workspace_json(workspace)),
        ]),
    }
}

fn loaded_workspace_json(workspace: &LoadedWorkspace) -> JsonValue {
    JsonValue::object([
        ("root", loaded_root_config_json(&workspace.root)),
        (
            "apps",
            array_of(&workspace.apps, |each| {
                JsonValue::object([
                    ("app", workspace_app_json(&each.app)),
                    ("config", loaded_app_config_json(&each.config)),
                ])
            }),
        ),
    ])
}

fn workspace_app_json(app: &WorkspaceApp) -> JsonValue {
    JsonValue::object([
        ("name", JsonValue::text(&app.name)),
        ("directory", JsonValue::text(app.directory.as_str())),
        ("file", JsonValue::text(app.file.as_str())),
    ])
}

fn loaded_root_config_json(config: &LoadedRootConfig) -> JsonValue {
    let mut members = vec![
        ("file", JsonValue::text(config.file.as_str())),
        ("displayName", JsonValue::text(&config.display_name)),
        ("apps", array_of(&config.apps, workspace_app_json)),
        ("sources", sources_json(&config.sources)),
    ];

    if let Some(allow_local) = config.allow_local {
        members.push(("allowLocal", JsonValue::Bool(allow_local)));
    }

    members.push(("openapi", array_of(&config.openapi, merged_document_json)));
    members.push(("checks", config.checks.clone()));

    JsonValue::object(members)
}

fn merged_document_json(document: &LoadedMergedDocument) -> JsonValue {
    JsonValue::object([
        ("name", JsonValue::text(&document.name)),
        ("file", JsonValue::text(document.file.as_str())),
        (
            "apps",
            array_of(&document.apps, |name| JsonValue::text(name)),
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
        ReadAppConfigOutcome::Read(config) => read_json("config", loaded_app_config_json(config)),
        ReadAppConfigOutcome::Refused(problems) => refused_json(problems),
    }
}

fn loaded_app_config_json(config: &LoadedAppConfig) -> JsonValue {
    let mut members = vec![
        ("file", JsonValue::text(config.file.as_str())),
        ("outDir", JsonValue::text(config.out_dir.as_str())),
    ];

    if let Some(allow_local) = config.allow_local {
        members.push(("allowLocal", JsonValue::Bool(allow_local)));
    }

    members.push(("sources", sources_json(&config.sources)));
    members.push((
        "entries",
        array_of(&config.entries, |each| {
            JsonValue::object([
                ("entry", each.entry.clone()),
                ("root", JsonValue::text(each.root.as_str())),
            ])
        }),
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

    push_present_texts(
        &mut members,
        [(
            "rootFile",
            config.root_file.as_ref().map(|file| file.as_str()),
        )],
    );

    JsonValue::object(members)
}

fn sources_json(sources: &IndexMap<String, ResolvedSource>) -> JsonValue {
    JsonValue::Object(
        sources
            .iter()
            .map(|(name, source)| {
                let json = match source {
                    ResolvedSource::Path { directory } => JsonValue::object([
                        ("kind", JsonValue::text("path")),
                        ("directory", JsonValue::text(directory.as_str())),
                    ]),
                    ResolvedSource::Bundle(bundle) => JsonValue::object([
                        ("kind", JsonValue::text("bundle")),
                        ("bundle", bundle_json(bundle)),
                    ]),
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
            ("package", JsonValue::text(&package.package)),
            ("version", JsonValue::text(&package.version)),
        ],
        BundleSourceForm::Release(release) => {
            vec![(
                "release",
                JsonValue::object([("url", JsonValue::text(&release.url))]),
            )]
        }
        BundleSourceForm::Git(git) => {
            let mut git_members = vec![
                ("url", JsonValue::text(&git.url)),
                ("tag", JsonValue::text(&git.tag)),
            ];

            push_present_texts(&mut git_members, [("directory", git.directory.as_deref())]);

            vec![("git", JsonValue::object(git_members))]
        }
        BundleSourceForm::Maven(coordinate) => vec![("maven", JsonValue::text(coordinate))],
    };

    push_present_texts(&mut members, [("integrity", bundle.integrity.as_deref())]);

    JsonValue::object(members)
}

fn problem_json(problem: &CliProblem) -> JsonValue {
    coded_problem_json(
        &problem.code,
        &problem.message,
        &problem.fix,
        [("where", problem.location.as_deref())],
    )
}
