//! The recorded planning calls of the CLI config: `selectArtefacts`, `planAppDocuments` and
//! `planMergedDocuments`, their arguments read back from the recorded JSON.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_cli_config::{
    ApiDocuments, AppChecksSettings, ConfiguredTargetEntry, DiffSettings, LoadedAppConfig,
    LoadedMergedDocument, LoadedRootConfig, LoadedWorkspace, LoadedWorkspaceApp, MergedApp,
    MergedContribution, MergedPlanError, OpenApiSettings, OperationsFilter, PlannedAppDocument,
    PlannedMergedDocument, Problems, ResolvedSource, TargetEntrySettings, WarningsSettings,
    WorkspaceApp, bundle_source_of, plan_app_documents, plan_merged_documents, select_artefacts,
};
use seampact_json::{JsonObject, JsonValue, items_of, object_of, text_of};
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};
use seampact_paths::node_path;
use seampact_target::TargetRole;

use super::cli_config::{answer, malformed_call, refused_json};
use crate::oracle::generator_registry::oracle_registry;
use crate::oracle::json::array_of;

/// The recorded `selectArtefacts(entry, target)`: the target is found by the package name its
/// recorded metadata carries.
pub(super) fn select_artefacts_answer(call: &RecordedToolCall) -> SubjectAnswer<RecordedAnswer> {
    let (Some(entry), Some(target)) = (call.args.first(), call.args.get(1)) else {
        return malformed_call(call);
    };
    let package_name = text_of(
        object_of(Some(target))
            .and_then(|object| object.object_member("metadata"))
            .and_then(|metadata| metadata.get("packageName")),
    );
    let Some(package_name) = package_name else {
        return malformed_call(call);
    };
    let Ok(generator) = oracle_registry().lookup(package_name) else {
        return internal(format!(
            "no generator of the oracle's registry is {package_name}"
        ));
    };
    let entry = match TargetEntrySettings::from_json(entry) {
        Ok(entry) => entry,
        Err(error) => return internal(error.to_string()),
    };

    match select_artefacts(&entry, generator) {
        Ok(artefacts) => answer(JsonValue::object([
            ("status", JsonValue::text("selected")),
            (
                "artefacts",
                JsonValue::Array(artefacts.iter().map(JsonValue::text).collect()),
            ),
        ])),
        Err(problems) => answer(refused_json(problems.as_slice())),
    }
}

/// The recorded `planAppDocuments(config, entryRoles, apiDocuments)`.
pub(super) fn plan_app_documents_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let (Some(config), Some(roles), Some(apis)) =
        (call.args.first(), call.args.get(1), call.args.get(2))
    else {
        return malformed_call(call);
    };
    let read = (|| {
        Ok::<_, String>((
            app_config_of(&rooted(config, root))?,
            roles_of(roles)?,
            api_documents_of(apis)?,
        ))
    })();
    let (config, roles, apis) = match read {
        Ok(read) => read,
        Err(message) => return internal(message),
    };

    // The roles are read only for the default documents, as the TypeScript reads them.
    let server_entries = match config.openapi {
        Some(_) => Some(Vec::new()),
        None => server_entries_of(&config, &roles),
    };
    let Some(server_entries) = server_entries else {
        return internal("a recorded entry has no role".to_owned());
    };

    answer(app_plan_json(&plan_app_documents(
        &config,
        &server_entries,
        &apis,
    )))
}

/// The recorded `planMergedDocuments(workspace, rolesByApp)`.
pub(super) fn plan_merged_documents_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let (Some(workspace), Some(roles_by_app)) = (call.args.first(), call.args.get(1)) else {
        return malformed_call(call);
    };
    let read = (|| {
        let mut by_app = IndexMap::new();

        for (app, roles) in members_of(roles_by_app)? {
            by_app.insert(app.clone(), roles_of(roles)?);
        }

        Ok::<_, String>((workspace_of(&rooted(workspace, root))?, by_app))
    })();
    let (workspace, roles_by_app) = match read {
        Ok(read) => read,
        Err(message) => return internal(message),
    };

    let mut apps = Vec::new();

    for each in &workspace.apps {
        let Some(server_entries) = roles_by_app
            .get(&each.app.name)
            .or_else(|| each.config.entries.is_empty().then_some(&NO_ROLES))
            .and_then(|roles| server_entries_of(&each.config, roles))
        else {
            return internal(format!(
                "no recorded entry roles for the app {}",
                each.app.name
            ));
        };

        apps.push(MergedApp {
            name: each.app.name.as_str(),
            config: &each.config,
            server_entries,
        });
    }

    match plan_merged_documents(&workspace.root, &apps) {
        Ok(plan) => answer(merged_plan_json(&plan)),
        Err(MergedPlanError::Refused(problems)) => answer(refused_json(problems.as_slice())),
        Err(MergedPlanError::Internal(error)) => internal(error.to_string()),
    }
}

/// The recorded roles of an app that has no entry.
static NO_ROLES: std::sync::LazyLock<IndexMap<String, TargetRole>> =
    std::sync::LazyLock::new(IndexMap::new);

/// The entries of `config` whose recorded role is `server`; none when an entry has no role.
fn server_entries_of<'config>(
    config: &'config LoadedAppConfig,
    roles: &IndexMap<String, TargetRole>,
) -> Option<Vec<&'config TargetEntrySettings>> {
    let mut server_entries = Vec::new();

    for each in &config.entries {
        if *roles.get(&each.settings.id)? == TargetRole::Server {
            server_entries.push(&each.settings);
        }
    }

    Some(server_entries)
}

fn internal(message: String) -> SubjectAnswer<RecordedAnswer> {
    SubjectAnswer::InternalError { message }
}

/// The value with the root token replaced by the run root in every string.
fn rooted(value: &JsonValue, root: &Utf8Path) -> JsonValue {
    match value {
        JsonValue::String(text) => JsonValue::String(text.replace(ROOT_TOKEN, root.as_str())),
        JsonValue::Array(items) => {
            JsonValue::Array(items.iter().map(|item| rooted(item, root)).collect())
        }
        JsonValue::Object(object) => JsonValue::Object(
            object
                .iter()
                .map(|(key, member)| (key.clone(), rooted(member, root)))
                .collect(),
        ),
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) => value.clone(),
    }
}

fn members_of(value: &JsonValue) -> Result<&JsonObject, String> {
    object_of(Some(value)).ok_or_else(|| "a recorded argument is not an object".to_owned())
}

fn text_member(object: &JsonObject, name: &str) -> Result<String, String> {
    object
        .text_member(name)
        .map(str::to_owned)
        .ok_or_else(|| format!("a recorded argument has no text member `{name}`"))
}

fn path_member(object: &JsonObject, name: &str) -> Result<Utf8PathBuf, String> {
    text_member(object, name).map(Utf8PathBuf::from)
}

fn member_value(object: &JsonObject, name: &str) -> Result<JsonValue, String> {
    object
        .get(name)
        .cloned()
        .ok_or_else(|| format!("a recorded argument has no member `{name}`"))
}

fn roles_of(value: &JsonValue) -> Result<IndexMap<String, TargetRole>, String> {
    members_of(value)?
        .iter()
        .map(|(entry, role)| {
            TargetRole::ALL
                .into_iter()
                .find(|each| Some(each.as_str()) == text_of(Some(role)))
                .map(|role| (entry.clone(), role))
                .ok_or_else(|| format!("the recorded role of {entry} is unknown"))
        })
        .collect()
}

fn api_documents_of(value: &JsonValue) -> Result<Vec<ApiDocuments>, String> {
    items_of(Some(value))
        .iter()
        .map(|each| {
            let object = members_of(each)?;

            Ok(ApiDocuments {
                source: text_member(object, "source")?,
                api: text_member(object, "api")?,
                documents: items_of(object.get("documents"))
                    .iter()
                    .filter_map(|document| text_of(Some(document)).map(str::to_owned))
                    .collect(),
            })
        })
        .collect()
}

fn sources_of(value: Option<&JsonValue>) -> Result<IndexMap<String, ResolvedSource>, String> {
    let Some(value) = value else {
        return Ok(IndexMap::new());
    };

    members_of(value)?
        .iter()
        .map(|(name, source)| {
            let object = members_of(source)?;
            let resolved = match object.text_member("kind") {
                Some("path") => ResolvedSource::Path {
                    directory: path_member(object, "directory")?,
                },
                Some("bundle") => ResolvedSource::Bundle(
                    bundle_source_of(&member_value(object, "bundle")?)
                        .map_err(|error| error.to_string())?,
                ),
                _ => return Err(format!("the recorded source {name} has no known kind")),
            };

            Ok((name.clone(), resolved))
        })
        .collect()
}

fn app_config_of(value: &JsonValue) -> Result<LoadedAppConfig, String> {
    let object = members_of(value)?;
    let file = path_member(object, "file")?;
    let directory = node_path::dirname(&file);
    let entries = items_of(object.get("entries"))
        .iter()
        .map(|each| {
            let each = members_of(each)?;

            Ok(ConfiguredTargetEntry {
                settings: TargetEntrySettings::from_json(&member_value(each, "entry")?)
                    .map_err(|error| error.to_string())?,
                root: path_member(each, "root")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let internal_text = |error: seampact_diagnostics::InternalError| error.to_string();

    Ok(LoadedAppConfig {
        file,
        out_dir: path_member(object, "outDir")?,
        allow_local: match object.get("allowLocal") {
            Some(JsonValue::Bool(flag)) => Some(*flag),
            _ => None,
        },
        sources: sources_of(object.get("sources"))?,
        entries,
        openapi: object
            .get("openapi")
            .map(|openapi| OpenApiSettings::from_value(openapi, &directory))
            .transpose()
            .map_err(internal_text)?,
        checks: AppChecksSettings::from_value(object.get("checks")).map_err(internal_text)?,
        diff: object
            .get("diff")
            .map(DiffSettings::from_value)
            .transpose()
            .map_err(internal_text)?,
        warnings: WarningsSettings::from_value(object.get("warnings")).map_err(internal_text)?,
        root_file: object.text_member("rootFile").map(Utf8PathBuf::from),
        written: JsonValue::Null,
    })
}

fn workspace_app_of(value: &JsonValue) -> Result<WorkspaceApp, String> {
    let object = members_of(value)?;

    Ok(WorkspaceApp {
        name: text_member(object, "name")?,
        directory: path_member(object, "directory")?,
        file: path_member(object, "file")?,
    })
}

fn workspace_of(value: &JsonValue) -> Result<LoadedWorkspace, String> {
    let object = members_of(value)?;
    let root = members_of(&member_value(object, "root")?)?.clone();
    let merged = items_of(root.get("openapi"))
        .iter()
        .map(|each| {
            let each = members_of(each)?;

            Ok(LoadedMergedDocument {
                name: text_member(each, "name")?,
                file: path_member(each, "file")?,
                apps: items_of(each.get("apps"))
                    .iter()
                    .filter_map(|app| text_of(Some(app)).map(str::to_owned))
                    .collect(),
                prefix: member_value(each, "prefix")?,
                options: member_value(each, "options")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let root_apps = items_of(root.get("apps"))
        .iter()
        .map(workspace_app_of)
        .collect::<Result<Vec<_>, _>>()?;
    let apps = items_of(object.get("apps"))
        .iter()
        .map(|each| {
            let each = members_of(each)?;

            Ok(LoadedWorkspaceApp {
                app: workspace_app_of(&member_value(each, "app")?)?,
                config: app_config_of(&member_value(each, "config")?)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let checks = member_value(&root, "checks")?;
    let checks_settings = AppChecksSettings::from_value(Some(&checks))
        .map_err(|error| error.to_string())?;

    Ok(LoadedWorkspace {
        root: LoadedRootConfig {
            file: path_member(&root, "file")?,
            display_name: text_member(&root, "displayName")?,
            apps: root_apps,
            sources: sources_of(root.get("sources"))?,
            allow_local: None,
            openapi: merged,
            checks_settings,
            checks,
        },
        apps,
    })
}

fn operations_json(operations: &OperationsFilter) -> JsonValue {
    let mut members = Vec::new();

    for (name, list) in [
        ("include", &operations.include),
        ("exclude", &operations.exclude),
    ] {
        if let Some(list) = list {
            members.push((name, array_of(list, |each| JsonValue::text(each))));
        }
    }

    JsonValue::object(members)
}

fn app_document_json(document: &PlannedAppDocument) -> JsonValue {
    let mut members = vec![
        ("source", JsonValue::text(&document.source)),
        ("api", JsonValue::text(&document.api)),
    ];

    if let Some(name) = &document.document {
        members.push(("document", JsonValue::text(name)));
    }

    members.push(("file", JsonValue::text(document.file.as_str())));
    members.push(("options", document.options.clone()));

    if let Some(served) = &document.served_operations {
        members.push(("servedOperations", array_of(served, operations_json)));
    }

    JsonValue::object(members)
}

fn app_plan_json(plan: &Result<Vec<PlannedAppDocument>, Problems>) -> JsonValue {
    match plan {
        Ok(documents) => JsonValue::object([
            ("status", JsonValue::text("planned")),
            ("documents", array_of(documents, app_document_json)),
        ]),
        Err(problems) => refused_json(problems.as_slice()),
    }
}

fn contribution_json(contribution: &MergedContribution) -> JsonValue {
    let mut members = vec![
        ("app", JsonValue::text(&contribution.app)),
        ("api", JsonValue::text(&contribution.api)),
    ];

    if let Some(entry) = &contribution.entry {
        members.push(("entry", JsonValue::text(entry)));
    }

    if let Some(document) = &contribution.document {
        members.push(("document", JsonValue::text(document)));
    }

    if let Some(operations) = &contribution.operations {
        members.push(("operations", operations_json(operations)));
    }

    JsonValue::object(members)
}

fn merged_document_json(document: &PlannedMergedDocument) -> JsonValue {
    JsonValue::object([
        ("name", JsonValue::text(&document.name)),
        ("file", JsonValue::text(document.file.as_str())),
        ("options", document.options.clone()),
        ("prefix", document.prefix.clone()),
        (
            "contributions",
            array_of(&document.contributions, contribution_json),
        ),
    ])
}

fn merged_plan_json(documents: &[PlannedMergedDocument]) -> JsonValue {
    JsonValue::object([
        ("status", JsonValue::text("planned")),
        ("documents", array_of(documents, merged_document_json)),
    ])
}
