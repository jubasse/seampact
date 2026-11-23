//! The app config of a project.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, items_of, object_of, text_of};
use seampact_paths::nfc_case_folded;

use crate::api_refs::parse_api_ref;
use crate::app_checks_settings::AppChecksSettings;
use crate::artefact_switch::ArtefactSwitch;
use crate::artefact_switches::is_framework_route_check_switched_off;
use crate::config_file::{ParseConfigOutcome, parse_config_file};
use crate::config_kind::ConfigKind;
use crate::config_names::{DEFAULT_OUT_DIR, ROOT_CONFIG_MARKER_KEY};
use crate::config_position::ParsedConfig;
use crate::config_schema::{ConfigSchema, ValidateConfigOutcome, validate_config};
use crate::config_waits::{find_config_waits, wait_problems};
use crate::diff_settings::DiffSettings;
use crate::find_root_config::{RootDiscovery, find_root_config};
use crate::key_path::KeyPathSegment;
use crate::maven_source::unpinned_maven_problems;
use crate::node_path::{directory_of, resolved_path};
use crate::open_api_settings::OpenApiSettings;
use crate::path_containment::{is_inside_or_equal, is_strictly_inside};
use crate::read_root_config::LoadedRootConfig;
use crate::resolved_source::{ResolvedSource, resolved_sources};
use crate::target_entry_settings::{
    ConfiguredTargetEntry, FrameworkDocsSwitch, TargetEntrySettings,
};
use crate::warnings_settings::WarningsSettings;
use crate::{CliConfigError, CliProblem};

/// An app config read and checked, with its file.
///
/// Every typed setting is read once, at load; planning reads the typed members, never `written`.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedAppConfig {
    /// The absolute path of the config file.
    pub file: Utf8PathBuf,
    /// The absolute output directory.
    pub out_dir: Utf8PathBuf,
    /// The app's `allowLocal`, else its root's; absent when neither sets it.
    pub allow_local: Option<bool>,
    /// The app's own sources and, for an app its root lists, the root's.
    pub sources: IndexMap<String, ResolvedSource>,
    /// The target entries with their output roots, in order.
    pub entries: Vec<ConfiguredTargetEntry>,
    /// The app's `openapi`; absent when the app does not write the key.
    pub openapi: Option<OpenApiSettings>,
    /// The app's `checks`; every level absent when the app writes none.
    pub checks: AppChecksSettings,
    /// The app's `diff` settings; absent when the app does not write the key.
    pub diff: Option<DiffSettings>,
    /// The app's `warnings`; nothing ignored when the app writes none.
    pub warnings: WarningsSettings,
    /// The root config folded in, for an app its root lists.
    pub root_file: Option<Utf8PathBuf>,
    /// The app config as its file writes it, for the oracle's answer; no planning reads it.
    pub written: JsonValue,
}

/// The config read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadAppConfigOutcome {
    /// The `config` member.
    Read(Box<LoadedAppConfig>),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

// The app config as its own file writes it, before its root is folded in.
struct AppConfigAlone {
    parsed: ParsedConfig,
    loaded: LoadedAppConfig,
}

enum ReadAloneOutcome {
    Read(Box<AppConfigAlone>),
    Refused(Vec<CliProblem>),
}

/// Reads the app config `file`, named `display_name` in problems; `text_file` holds its text when it differs.
///
/// YAML, prototype keys and waiting keys are refused, the value is checked against the app config
/// schema, and paths are resolved against the directory of the file. The root config that lists
/// the app, when there is one, is then folded in: its sources beside the app's and its
/// `allowLocal` under the app's.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a file cannot be read, [`CliConfigError::Internal`] for a bug.
pub fn read_app_config(
    file: &Utf8Path,
    display_name: &str,
    text_file: Option<&Utf8Path>,
) -> Result<ReadAppConfigOutcome, CliConfigError> {
    let alone = match read_app_config_alone(file, display_name, text_file)? {
        ReadAloneOutcome::Refused(problems) => return Ok(ReadAppConfigOutcome::Refused(problems)),
        ReadAloneOutcome::Read(alone) => alone,
    };

    match find_root_config(file, display_name)? {
        RootDiscovery::Refused(problems) => Ok(ReadAppConfigOutcome::Refused(problems)),
        RootDiscovery::None => Ok(ReadAppConfigOutcome::Read(Box::new(alone.loaded))),
        RootDiscovery::Found {
            root,
            listed: false,
        } => unlisted_app_outcome(*alone, &root),
        RootDiscovery::Found { root, listed: true } => fold_root_config(*alone, &root),
    }
}

/// Reads the app config `file` that the root config `root` lists, and folds the root in.
///
/// # Errors
///
/// As [`read_app_config`].
pub fn read_listed_app_config(
    file: &Utf8Path,
    display_name: &str,
    root: &LoadedRootConfig,
) -> Result<ReadAppConfigOutcome, CliConfigError> {
    match read_app_config_alone(file, display_name, None)? {
        ReadAloneOutcome::Refused(problems) => Ok(ReadAppConfigOutcome::Refused(problems)),
        ReadAloneOutcome::Read(alone) => fold_root_config(*alone, root),
    }
}

fn read_app_config_alone(
    file: &Utf8Path,
    display_name: &str,
    text_file: Option<&Utf8Path>,
) -> Result<ReadAloneOutcome, CliConfigError> {
    let (parsed, value) =
        match parse_config_file(text_file.unwrap_or(file), display_name, ConfigKind::App)? {
            ParseConfigOutcome::Refused(problems) => {
                return Ok(ReadAloneOutcome::Refused(problems));
            }
            ParseConfigOutcome::Parsed { parsed, value } => (*parsed, value),
        };
    let key_problems = wait_problems(&parsed, find_config_waits(&value))?;

    // A root config is not read as an app's: a command that runs on a root reads it with `readRunConfig`.
    if object_of(Some(&value)).is_some_and(|object| object.contains_key(ROOT_CONFIG_MARKER_KEY)) {
        return Ok(ReadAloneOutcome::Refused(vec![root_config_problem(
            &parsed,
        )?]));
    }

    match validate_config(&parsed, &value, ConfigSchema::App, key_problems)? {
        ValidateConfigOutcome::Refused(problems) => Ok(ReadAloneOutcome::Refused(problems)),
        ValidateConfigOutcome::Valid => resolve_app_config(file, parsed, value),
    }
}

fn root_config_problem(parsed: &ParsedConfig) -> Result<CliProblem, InternalError> {
    Ok(CliProblem::at(
        "config.root.not-an-app",
        format!(
            "This file is a monorepo root config (it holds `{ROOT_CONFIG_MARKER_KEY}`), and the command runs on one app's config."
        ),
        "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
        parsed.where_of(&[KeyPathSegment::key(ROOT_CONFIG_MARKER_KEY)])?,
    ))
}

fn resolve_app_config(
    file: &Utf8Path,
    parsed: ParsedConfig,
    config: JsonValue,
) -> Result<ReadAloneOutcome, CliConfigError> {
    let object = object_of(Some(&config)).ok_or_else(|| {
        InternalError::new("an app config that is not a mapping passed the schema")
    })?;
    let directory = directory_of(file);
    let out_dir = resolved_path(
        &directory,
        text_of(object.get("outDir")).unwrap_or(DEFAULT_OUT_DIR),
    );
    let entries = items_of(object.get("targets"))
        .iter()
        .map(|entry| configured_entry(entry, &out_dir))
        .collect::<Result<Vec<_>, _>>()?;
    let mut problems = unpinned_maven_problems(&parsed, object.get("sources"))?;

    problems.extend(duplicate_id_problems(&parsed, &entries)?);
    problems.extend(outside_out_dir_problems(&parsed, &out_dir, &entries)?);
    problems.extend(overlapping_out_problems(&parsed, &entries)?);
    problems.extend(switched_off_allow_list_problems(&parsed, &entries)?);
    problems.extend(framework_docs_conflict_problems(&parsed, &entries)?);

    if !problems.is_empty() {
        return Ok(ReadAloneOutcome::Refused(problems));
    }

    let allow_local = match object.get("allowLocal") {
        Some(JsonValue::Bool(flag)) => Some(*flag),
        _ => None,
    };
    let loaded = LoadedAppConfig {
        file: file.to_path_buf(),
        out_dir,
        allow_local,
        sources: resolved_sources(&directory, object.get("sources"))?,
        entries,
        openapi: object
            .get("openapi")
            .map(|openapi| OpenApiSettings::from_value(openapi, &directory))
            .transpose()?,
        checks: AppChecksSettings::from_value(object.get("checks"))?,
        diff: object
            .get("diff")
            .map(DiffSettings::from_value)
            .transpose()?,
        warnings: WarningsSettings::from_value(object.get("warnings"))?,
        root_file: None,
        written: config,
    };

    Ok(ReadAloneOutcome::Read(Box::new(AppConfigAlone {
        parsed,
        loaded,
    })))
}

fn configured_entry(
    entry: &JsonValue,
    out_dir: &Utf8Path,
) -> Result<ConfiguredTargetEntry, InternalError> {
    let settings = TargetEntrySettings::from_json(entry)?;
    let directory_name = settings.out.as_deref().unwrap_or(&settings.id);
    let root = resolved_path(out_dir, directory_name);

    Ok(ConfiguredTargetEntry { settings, root })
}

fn entry_path(index: usize, key: &str) -> [KeyPathSegment; 3] {
    [
        KeyPathSegment::key("targets"),
        KeyPathSegment::position(index),
        KeyPathSegment::key(key),
    ]
}

fn duplicate_id_problems(
    parsed: &ParsedConfig,
    entries: &[ConfiguredTargetEntry],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let ids: Vec<&str> = entries
        .iter()
        .map(|each| each.settings.id.as_str())
        .collect();
    let mut problems = Vec::new();

    for (index, id) in ids.iter().enumerate() {
        if ids.iter().position(|other| other == id) == Some(index) {
            continue;
        }

        problems.push(CliProblem::at(
            "config.target.duplicate-id",
            format!("Two target entries have the id '{id}'."),
            "Give each target entry its own id.",
            parsed.where_of(&entry_path(index, "id"))?,
        ));
    }

    Ok(problems)
}

fn switched_off_allow_list_problems(
    parsed: &ParsedConfig,
    entries: &[ConfiguredTargetEntry],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, each) in entries.iter().enumerate() {
        let entry = &each.settings;

        if entry.framework_routes.is_none()
            || !is_framework_route_check_switched_off(entry.artefacts.as_ref())
        {
            continue;
        }

        problems.push(CliProblem::at(
            "config.key.conflict",
            format!(
                "The entry '{}' allow-lists framework routes in 'frameworkRoutes' but switches their check off with '{}: false'.",
                entry.id,
                switch_off_key(entry)
            ),
            "Keep one: remove 'frameworkRoutes' to leave the check off, or remove the switch to check the routes against the allow-list.",
            parsed.where_of(&entry_path(index, "frameworkRoutes"))?,
        ));
    }

    Ok(problems)
}

fn switch_off_key(entry: &TargetEntrySettings) -> &'static str {
    let boot_check = entry
        .artefacts
        .as_ref()
        .and_then(|switches| switches.0.get("bootCheck"));

    if boot_check == Some(&ArtefactSwitch::Flag(false)) {
        return "artefacts.bootCheck";
    }

    "artefacts.bootCheck.frameworkRoutes"
}

fn framework_docs_conflict_problems(
    parsed: &ParsedConfig,
    entries: &[ConfiguredTargetEntry],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, each) in entries.iter().enumerate() {
        let entry = &each.settings;
        let docs_off = entry.framework_docs == Some(FrameworkDocsSwitch::Off);
        let native_docs = entry
            .artefacts
            .as_ref()
            .and_then(|switches| switches.0.get("nativeDocs"))
            == Some(&ArtefactSwitch::Flag(true));

        if !docs_off || !native_docs {
            continue;
        }

        problems.push(CliProblem::at(
            "config.key.conflict",
            format!(
                "The entry '{}' sets 'frameworkDocs: off' and 'artefacts.nativeDocs: true': one switches the framework's document off, the other completes it.",
                entry.id
            ),
            "Keep one: remove 'frameworkDocs: off' to complete the framework's document, or switch 'artefacts.nativeDocs' off.",
            parsed.where_of(&entry_path(index, "frameworkDocs"))?,
        ));
    }

    Ok(problems)
}

fn outside_out_dir_problems(
    parsed: &ParsedConfig,
    out_dir: &Utf8Path,
    entries: &[ConfiguredTargetEntry],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, each) in entries.iter().enumerate() {
        if is_strictly_inside(out_dir, &each.root) {
            continue;
        }

        problems.push(CliProblem::at(
            "config.out.outside",
            format!(
                "The output directory of '{}' is not inside `outDir` ({out_dir}).",
                each.settings.id
            ),
            "Give `out` a relative path that stays inside `outDir`.",
            parsed.where_of(&entry_path(index, "out"))?,
        ));
    }

    Ok(problems)
}

fn overlapping_out_problems(
    parsed: &ParsedConfig,
    entries: &[ConfiguredTargetEntry],
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (index, each) in entries.iter().enumerate() {
        for other in entries.iter().skip(index.saturating_add(1)) {
            let path = [
                KeyPathSegment::key("targets"),
                KeyPathSegment::position(index),
            ];
            let (first, second) = (&each.settings.id, &other.settings.id);

            if is_nested_or_same(&each.root, &other.root) {
                problems.push(CliProblem::at(
                    "config.out.overlap",
                    format!("The entries '{first}' and '{second}' write to the same directory, or one inside the other."),
                    "Give each entry its own `out` directory, side by side under `outDir`.",
                    parsed.where_of(&path)?,
                ));
            } else if is_nested_or_same(
                &case_folded_after_nfc(&each.root),
                &case_folded_after_nfc(&other.root),
            ) {
                problems.push(CliProblem::at(
                    "config.out.case-overlap",
                    format!("The entries '{first}' and '{second}' write to directories that are one, or one inside the other, once letter case is ignored, as a case-insensitive disk does."),
                    "Give each entry an `out` directory whose name differs by more than letter case, side by side under `outDir`.",
                    parsed.where_of(&path)?,
                ));
            }
        }
    }

    Ok(problems)
}

fn case_folded_after_nfc(path: &Utf8Path) -> Utf8PathBuf {
    Utf8PathBuf::from(nfc_case_folded(path.as_str()))
}

fn is_nested_or_same(first: &Utf8Path, second: &Utf8Path) -> bool {
    is_inside_or_equal(first, second) || is_inside_or_equal(second, first)
}

fn fold_root_config(
    app: AppConfigAlone,
    root: &LoadedRootConfig,
) -> Result<ReadAppConfigOutcome, CliConfigError> {
    let mut problems = Vec::new();

    for name in app
        .loaded
        .sources
        .keys()
        .filter(|name| root.sources.contains_key(*name))
    {
        let path = [KeyPathSegment::key("sources"), KeyPathSegment::key(name)];

        problems.push(CliProblem::at(
            "config.source.duplicate",
            format!(
                "The source '{name}' is defined both in this app config and in its root config {}.",
                root.display_name
            ),
            "Remove the app's definition to use the root's source, or rename one of them.",
            app.parsed.where_of(&path)?,
        ));
    }

    if !problems.is_empty() {
        return Ok(ReadAppConfigOutcome::Refused(problems));
    }

    let mut sources = root.sources.clone();

    sources.extend(app.loaded.sources.clone());

    Ok(ReadAppConfigOutcome::Read(Box::new(LoadedAppConfig {
        allow_local: app.loaded.allow_local.or(root.allow_local),
        sources,
        root_file: Some(root.file.clone()),
        ..app.loaded
    })))
}

fn unlisted_app_outcome(
    app: AppConfigAlone,
    root: &LoadedRootConfig,
) -> Result<ReadAppConfigOutcome, CliConfigError> {
    let root_only_sources: Vec<&String> = root
        .sources
        .keys()
        .filter(|name| !app.loaded.sources.contains_key(*name))
        .collect();
    let mut problems = Vec::new();

    for (index, each) in app.loaded.entries.iter().enumerate() {
        let names_root_source = |reference: &&str| {
            parse_api_ref(reference)
                .source
                .is_some_and(|source| root_only_sources.iter().any(|name| name.as_str() == source))
        };

        for reference in each
            .settings
            .api_refs()
            .into_iter()
            .filter(names_root_source)
        {
            let path = [
                KeyPathSegment::key("targets"),
                KeyPathSegment::position(index),
            ];

            problems.push(CliProblem::at(
                "config.app.unlisted",
                format!(
                    "The api '{reference}' names a source of the root config {}, whose `apps` does not list this app ({}), so the app stands alone.",
                    root.display_name,
                    directory_of(&app.loaded.file)
                ),
                "Add the app's directory to the root config's `apps`, or define the source in this app config.",
                app.parsed.where_of(&path)?,
            ));
        }
    }

    if !problems.is_empty() {
        return Ok(ReadAppConfigOutcome::Refused(problems));
    }

    Ok(ReadAppConfigOutcome::Read(Box::new(app.loaded)))
}
