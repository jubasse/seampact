//! The root config of a monorepo.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue, items_of, object_of, text_of};

use crate::app_checks_settings::AppChecksSettings;
use crate::config_file::{ParseConfigOutcome, parse_config_file};
use crate::config_kind::ConfigKind;
use crate::config_names::APP_CONFIG_FILE_NAME;
use crate::config_position::ParsedConfig;
use crate::config_schema::{ConfigSchema, ValidateConfigOutcome, validate_config};
use crate::key_path::KeyPathSegment;
use crate::key_problem::KeyProblem;
use crate::maven_source::unpinned_maven_problems;
use crate::path_containment::is_strictly_inside;
use crate::resolved_source::{ResolvedSource, resolved_sources};
use crate::{CliConfigError, CliProblem};
use seampact_paths::node_path;

/// The keys of an app config that a root config does not take: they concern one app.
const APP_ONLY_KEYS: [&str; 4] = ["outDir", "targets", "diff", "warnings"];

/// The `checks` an app config takes and a root does not: they concern an app's own targets and framework.
const APP_ONLY_CHECKS: [&str; 2] = ["generated", "matrix"];

/// The members of a merged document that are emitter options.
const DOCUMENT_OPTION_KEYS: [&str; 4] = ["extensions", "reasons", "inputSchemas", "servers"];

/// One app a root config lists: its name as `apps` writes it, and its absolute directory and config file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceApp {
    /// The directory as `apps` writes it.
    pub name: String,
    /// The absolute directory.
    pub directory: Utf8PathBuf,
    /// The absolute path of the app's config file.
    pub file: Utf8PathBuf,
}

/// A merged document of the root, its path absolute and its apps defaulted to every app of `apps`.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedMergedDocument {
    /// The document name.
    pub name: String,
    /// The absolute path of the document.
    pub file: Utf8PathBuf,
    /// The names of the apps it merges.
    pub apps: Vec<String>,
    /// The path prefix of each api, as written.
    pub prefix: JsonValue,
    /// The emitter options the entry writes.
    pub options: JsonValue,
}

/// A root config read and checked, with its file.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedRootConfig {
    /// The absolute path of the config file.
    pub file: Utf8PathBuf,
    /// The file as problems name it.
    pub display_name: String,
    /// The apps the root lists, in order.
    pub apps: Vec<WorkspaceApp>,
    /// The sources the root defines.
    pub sources: IndexMap<String, ResolvedSource>,
    /// The root's `allowLocal`, absent when the root does not set it.
    pub allow_local: Option<bool>,
    /// The merged documents, in order.
    pub openapi: Vec<LoadedMergedDocument>,
    /// The root's `checks` as written; an empty mapping when absent.
    pub checks: JsonValue,
    /// The root's `checks` read into their levels, once at load.
    pub checks_settings: AppChecksSettings,
}

/// The config read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadRootConfigOutcome {
    /// The `config` member.
    Read(Box<LoadedRootConfig>),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the root config `file`, named `display_name` in problems.
///
/// YAML and prototype keys are refused as for an app config, the keys of one app are refused naming
/// the app config as their place, the value is checked against the root schema, then each app
/// directory must lie below the root and hold its own app config.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a file cannot be read, [`CliConfigError::Internal`] for a bug.
pub fn read_root_config(
    file: &Utf8Path,
    display_name: &str,
) -> Result<ReadRootConfigOutcome, CliConfigError> {
    let (parsed, value) = match parse_config_file(file, display_name, ConfigKind::Root)? {
        ParseConfigOutcome::Refused(problems) => {
            return Ok(ReadRootConfigOutcome::Refused(problems));
        }
        ParseConfigOutcome::Parsed { parsed, value } => (*parsed, value),
    };
    let key_problems = app_only_key_problems(&parsed, &value)?;

    match validate_config(&parsed, &value, ConfigSchema::Root, key_problems)? {
        ValidateConfigOutcome::Refused(problems) => Ok(ReadRootConfigOutcome::Refused(problems)),
        ValidateConfigOutcome::Valid => resolve_root_config(file, &parsed, &value),
    }
}

fn app_only_key_problems(
    parsed: &ParsedConfig,
    value: &JsonValue,
) -> Result<Vec<KeyProblem>, CliConfigError> {
    let Some(object) = object_of(Some(value)) else {
        return Ok(Vec::new());
    };
    let checks = object_of(object.get("checks"));
    let mut paths: Vec<Vec<&str>> = APP_ONLY_KEYS
        .iter()
        .filter(|key| object.contains_key(key))
        .map(|key| vec![*key])
        .collect();

    paths.extend(
        APP_ONLY_CHECKS
            .iter()
            .filter(|key| checks.is_some_and(|checks| checks.contains_key(key)))
            .map(|key| vec!["checks", *key]),
    );

    paths
        .into_iter()
        .map(|names| {
            let path: Vec<KeyPathSegment> = names.iter().map(|name| KeyPathSegment::key(name)).collect();
            let joined = names.join(".");

            Ok(KeyProblem {
                problem: CliProblem::at(
                    "config.root.app-key",
                    format!(
                        "'{joined}' belongs to one app, and this root config (it holds `apps`) takes the keys its apps share."
                    ),
                    &format!("Move '{joined}' to the `{APP_CONFIG_FILE_NAME}` of the app it concerns."),
                    parsed.where_of(&path)?,
                ),
                path,
            })
        })
        .collect()
}

fn resolve_root_config(
    file: &Utf8Path,
    parsed: &ParsedConfig,
    config: &JsonValue,
) -> Result<ReadRootConfigOutcome, CliConfigError> {
    let directory = node_path::dirname(file);
    let object = object_of(Some(config)).ok_or_else(|| {
        InternalError::new("a root config that is not a mapping passed the schema")
    })?;
    let apps = workspace_apps(&directory, object.get("apps"))?;
    let mut problems = unpinned_maven_problems(parsed, object.get("sources"))?;

    problems.extend(app_placement_problems(parsed, &directory, &apps)?);
    problems.extend(duplicate_app_problems(parsed, &apps)?);
    problems.extend(unknown_merged_app_problems(
        parsed, object, &directory, &apps,
    )?);

    if !problems.is_empty() {
        return Ok(ReadRootConfigOutcome::Refused(problems));
    }

    let openapi = object_of(object.get("openapi"))
        .into_iter()
        .flat_map(|documents| documents.iter())
        .map(|(name, entry)| loaded_merged_document(&directory, name, entry, &apps))
        .collect::<Result<Vec<_>, _>>()?;
    let allow_local = match object.get("allowLocal") {
        Some(JsonValue::Bool(flag)) => Some(*flag),
        _ => None,
    };

    let checks = object
        .get("checks")
        .cloned()
        .unwrap_or_else(|| JsonValue::Object(JsonObject::new()));
    let checks_settings = AppChecksSettings::from_value(Some(&checks))?;

    Ok(ReadRootConfigOutcome::Read(Box::new(LoadedRootConfig {
        file: file.to_path_buf(),
        display_name: parsed.display_name.clone(),
        apps,
        sources: resolved_sources(&directory, object.get("sources"))?,
        allow_local,
        openapi,
        checks,
        checks_settings,
    })))
}

fn workspace_apps(
    directory: &Utf8Path,
    apps: Option<&JsonValue>,
) -> Result<Vec<WorkspaceApp>, InternalError> {
    items_of(apps)
        .iter()
        .map(|name| {
            let name = text_of(Some(name))
                .ok_or_else(|| InternalError::new("an app that is not text passed the schema"))?;
            let app_directory = node_path::resolve(directory, name);

            Ok(WorkspaceApp {
                name: name.to_owned(),
                file: app_directory.join(APP_CONFIG_FILE_NAME),
                directory: app_directory,
            })
        })
        .collect()
}

fn loaded_merged_document(
    directory: &Utf8Path,
    name: &str,
    entry: &JsonValue,
    root_apps: &[WorkspaceApp],
) -> Result<LoadedMergedDocument, InternalError> {
    let entry_object = object_of(Some(entry)).ok_or_else(|| {
        InternalError::new("a merged document that is not a mapping passed the schema")
    })?;
    let path = text_of(entry_object.get("path"))
        .ok_or_else(|| InternalError::new("a merged document without a path passed the schema"))?;
    let apps = match entry_object.get("apps") {
        None => root_apps.iter().map(|app| app.name.clone()).collect(),
        Some(listed) => items_of(Some(listed))
            .iter()
            .map(|item| listed_app(directory, item, root_apps).map(|app| app.name.clone()))
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(LoadedMergedDocument {
        name: name.to_owned(),
        file: node_path::resolve(directory, path),
        apps,
        prefix: entry_object
            .get("prefix")
            .cloned()
            .unwrap_or_else(|| JsonValue::Object(JsonObject::new())),
        options: document_options_of(entry_object),
    })
}

/// The emitter options of a document entry, copied in the order the emitter reads them.
pub(crate) fn document_options_of(entry: &JsonObject) -> JsonValue {
    JsonValue::Object(
        DOCUMENT_OPTION_KEYS
            .iter()
            .filter_map(|key| {
                entry
                    .get(key)
                    .map(|value| ((*key).to_owned(), value.clone()))
            })
            .collect(),
    )
}

fn app_placement_problems(
    parsed: &ParsedConfig,
    directory: &Utf8Path,
    apps: &[WorkspaceApp],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, app) in apps.iter().enumerate() {
        let path = [KeyPathSegment::key("apps"), KeyPathSegment::position(index)];
        let location = parsed.where_of(&path)?;
        let name = &app.name;

        if app.directory == directory {
            problems.push(CliProblem::at(
                "config.apps.outside",
                format!("'{name}' is the root config's own directory; each app has its own directory below it."),
                "Move the app into a directory of its own below the root, with its own `seampact.config.yaml`.",
                location,
            ));
        } else if !is_strictly_inside(directory, &app.directory) {
            problems.push(CliProblem::at(
                "config.apps.outside",
                format!("The app directory '{name}' is not below the root config's directory ({directory})."),
                "List app directories relative to the root config, below it.",
                location,
            ));
        } else if !app.file.exists() {
            problems.push(CliProblem::at(
                "config.apps.no-config",
                format!("The app directory '{name}' holds no `{APP_CONFIG_FILE_NAME}`."),
                &format!(
                    "Create the app's `{APP_CONFIG_FILE_NAME}`, or correct the directory in `apps`."
                ),
                location,
            ));
        }
    }

    Ok(problems)
}

fn duplicate_app_problems(
    parsed: &ParsedConfig,
    apps: &[WorkspaceApp],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, app) in apps.iter().enumerate() {
        let first = apps
            .iter()
            .take(index)
            .find(|other| other.directory == app.directory);
        let Some(first) = first else {
            continue;
        };
        let path = [KeyPathSegment::key("apps"), KeyPathSegment::position(index)];

        problems.push(CliProblem::at(
            "config.apps.duplicate",
            format!(
                "'{}' and '{}' name the same app directory.",
                app.name, first.name
            ),
            "List each app once.",
            parsed.where_of(&path)?,
        ));
    }

    Ok(problems)
}

fn unknown_merged_app_problems(
    parsed: &ParsedConfig,
    config: &JsonObject,
    directory: &Utf8Path,
    apps: &[WorkspaceApp],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();
    let listed_names: Vec<&str> = apps.iter().map(|app| app.name.as_str()).collect();

    for (name, entry) in object_of(config.get("openapi"))
        .into_iter()
        .flat_map(|object| object.iter())
    {
        let merged_apps = object_of(Some(entry)).and_then(|object| object.get("apps"));

        for (index, app) in items_of(merged_apps).iter().enumerate() {
            let app = text_of(Some(app)).ok_or_else(|| {
                InternalError::new("a merged document app that is not text passed the schema")
            })?;

            if find_listed_app(directory, app, apps).is_some() {
                continue;
            }

            let path = [
                KeyPathSegment::key("openapi"),
                KeyPathSegment::key(name),
                KeyPathSegment::key("apps"),
                KeyPathSegment::position(index),
            ];

            problems.push(CliProblem::at(
                "config.openapi.unknown-app",
                format!(
                    "The merged document '{name}' covers '{app}', which `apps` does not list ({}).",
                    listed_names.join(", ")
                ),
                "Name a directory `apps` lists, or add the app to `apps`.",
                parsed.where_of(&path)?,
            ));
        }
    }

    Ok(problems)
}

fn find_listed_app<'apps>(
    directory: &Utf8Path,
    item: &str,
    apps: &'apps [WorkspaceApp],
) -> Option<&'apps WorkspaceApp> {
    let item_directory = node_path::resolve(directory, item);

    apps.iter().find(|app| app.directory == item_directory)
}

fn listed_app<'apps>(
    directory: &Utf8Path,
    item: &JsonValue,
    apps: &'apps [WorkspaceApp],
) -> Result<&'apps WorkspaceApp, InternalError> {
    let item = text_of(Some(item)).ok_or_else(|| {
        InternalError::new("a merged document app that is not text passed the schema")
    })?;

    find_listed_app(directory, item, apps).ok_or_else(|| {
        InternalError::new(format!(
            "the merged document's app {item} passed the apps check unlisted"
        ))
    })
}
