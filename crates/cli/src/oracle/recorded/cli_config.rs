//! The recorded calls of the CLI config readers: the brief that ports each recorded function reads
//! its arguments and converts its result here.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_cli_config::{
    CliConfigError, CliProblem, LoadedAppConfig, ReadAppConfigOutcome, ResolvedSource,
    read_app_config,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};

use crate::oracle::stub_answer::{StubError, failed_answer};

impl StubError for CliConfigError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

/// Replays a recorded call of the CLI config readers on the case root.
pub(super) fn cli_config_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    match call.function.as_str() {
        "readAppConfig" => read_app_config_answer(call, root),
        _ => SubjectAnswer::NotPorted,
    }
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
                        object([("kind", text("bundle")), ("bundle", bundle.clone())])
                    }
                };

                (name.clone(), json)
            })
            .collect(),
    )
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
