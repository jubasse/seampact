//! The documents an app config plans: the names of the apis its `openapi` key documents.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue, object_of, text_of};
use seampact_target::TargetRole;
use serde::Deserialize;
use serde::de::IgnoredAny;

use crate::api_refs::{api_refs_of, parse_api_ref};
use crate::node_path::{directory_of, joined_path, resolved_path};
use crate::operations_filter::OperationsFilter;
use crate::path_containment::is_inside_or_equal;
use crate::read_app_config::LoadedAppConfig;
use crate::read_root_config::document_options_of;
use crate::read_workspace_configs::LoadedWorkspace;
use crate::{CliConfigError, CliProblem, located_problem};

/// The default directory of an app's documents, beside its config file.
const DEFAULT_DOCUMENT_DIRECTORY: &str = "openapi";

const DOCUMENT_EXTENSION: &str = ".yaml";

/// The text of `openapi: none`, the app writing no document.
const NO_OPENAPI_DOCUMENTS: &str = "none";

/// The apis an app's `openapi` documents, in the order the TypeScript reads object keys; empty
/// for `openapi: none`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OpenApiSettings {
    /// The api names the `openapi` mapping writes.
    pub apis: Vec<String>,
}

// The key as the config writes it: `none`, or a mapping from api names to their documents.
#[derive(Deserialize)]
#[serde(untagged)]
enum WrittenOpenApi {
    Switch(String),
    Documents(IndexMap<String, IgnoredAny>),
}

impl OpenApiSettings {
    /// The settings of an `openapi` value the config schema passed.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value is neither `none` nor a mapping.
    pub fn from_value(value: &JsonValue) -> Result<Self, InternalError> {
        let written: WrittenOpenApi = serde_json::to_value(value)
            .and_then(serde_json::from_value)
            .map_err(|error| {
                InternalError::new(format!(
                    "an openapi value outside the schema's passed it: {error}"
                ))
            })?;

        match written {
            WrittenOpenApi::Switch(text) if text == NO_OPENAPI_DOCUMENTS => Ok(Self::default()),
            WrittenOpenApi::Switch(text) => Err(InternalError::new(format!(
                "an openapi text '{text}' passed the schema"
            ))),
            WrittenOpenApi::Documents(documents) => Ok(Self {
                apis: js_key_order(documents.keys().map(|name| (name, ())))
                    .map(|(name, ())| name.clone())
                    .collect(),
            }),
        }
    }
}

impl LoadedAppConfig {
    /// The app's `openapi` settings; `None` when the app does not write the key.
    ///
    /// # Errors
    ///
    /// [`InternalError`] as [`OpenApiSettings::from_value`].
    pub fn openapi_settings(&self) -> Result<Option<OpenApiSettings>, InternalError> {
        self.openapi
            .as_ref()
            .map(OpenApiSettings::from_value)
            .transpose()
    }
}

/// The api names the app's `openapi` maps to documents; none when it is absent or `none`.
///
/// # Errors
///
/// [`InternalError`] as [`OpenApiSettings::from_value`].
pub fn open_api_api_names(config: &LoadedAppConfig) -> Result<Vec<String>, InternalError> {
    Ok(config
        .openapi_settings()?
        .map(|settings| settings.apis)
        .unwrap_or_default())
}

/// A compiled api the app sees, with the ids of the documents it declares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiDocuments {
    /// The source holding the api.
    pub source: String,
    /// The api name.
    pub api: String,
    /// The declared document ids; none for an api without `documents`.
    pub documents: Vec<String>,
}

/// One OpenAPI document an app writes.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedAppDocument {
    /// The source holding the api.
    pub source: String,
    /// The api name.
    pub api: String,
    /// The api's document id; absent for the one document of an api that declares none.
    pub document: Option<String>,
    /// The absolute file the document is written to.
    pub file: Utf8PathBuf,
    /// The emitter options as the config writes them, an empty object when it writes none.
    pub options: JsonValue,
    /// The `operations` of each server entry serving the api, whose union the document holds;
    /// absent when one of them serves the whole api, or when `openapi` lists the document.
    pub served_operations: Option<Vec<OperationsFilter>>,
}

/// The documents an app writes, or the problems that refuse the plan.
#[derive(Debug, Clone, PartialEq)]
pub enum AppDocumentPlan {
    /// The documents, in order.
    Planned(Vec<PlannedAppDocument>),
    /// The problems.
    Refused(Vec<CliProblem>),
}

/// What one app gives a merged document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergedContribution {
    /// The app's name in the root's `apps`.
    pub app: String,
    /// The api as the entry or the `openapi` key names it, `<api>` or `<source>/<api>`.
    pub api: String,
    /// The server entry that contributes it.
    pub entry: Option<String>,
    /// The document id.
    pub document: Option<String>,
    /// The entry's `operations`.
    pub operations: Option<OperationsFilter>,
}

/// One merged document of a root with what its apps contribute.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedMergedDocument {
    /// The document's name.
    pub name: String,
    /// The absolute file.
    pub file: Utf8PathBuf,
    /// The emitter options as the root writes them.
    pub options: JsonValue,
    /// The path prefix of each app, as the root writes it.
    pub prefix: JsonValue,
    /// What each app contributes, in order.
    pub contributions: Vec<MergedContribution>,
}

/// The merged documents of a root, or the problems that refuse the plan.
#[derive(Debug, Clone, PartialEq)]
pub enum MergedDocumentPlan {
    /// The documents, in order.
    Planned(Vec<PlannedMergedDocument>),
    /// The problems.
    Refused(Vec<CliProblem>),
}

/// The default directory of an app's documents, beside its config file.
#[must_use]
pub fn default_document_directory(config: &LoadedAppConfig) -> Utf8PathBuf {
    joined_path(
        &directory_of(&config.file),
        Utf8Path::new(DEFAULT_DOCUMENT_DIRECTORY),
    )
}

/// The documents an app writes: those its `openapi` lists, none for `none`, and without the key
/// every document of every api its server targets generate from, at `openapi/<api>.yaml` or
/// `openapi/<api>.<document>.yaml`. `entry_roles` holds each entry's role by entry id.
///
/// # Errors
///
/// [`CliConfigError::Internal`] when an entry has no role, or the config holds a shape its schema
/// refuses.
pub fn plan_app_documents(
    config: &LoadedAppConfig,
    entry_roles: &IndexMap<String, TargetRole>,
    api_documents: &[ApiDocuments],
) -> Result<AppDocumentPlan, CliConfigError> {
    let planned = match &config.openapi {
        None => default_documents(config, entry_roles, api_documents)?,
        Some(openapi) => listed_documents(config, openapi, api_documents)?,
    };
    let AppDocumentPlan::Planned(documents) = planned else {
        return Ok(planned);
    };
    let names: Vec<NamedFile<'_>> = documents
        .iter()
        .map(|each| NamedFile {
            file: each.file.as_str(),
            name: name_of(each),
        })
        .collect();
    let mut problems = document_inside_output_problems(config, &documents)?;

    problems.extend(path_conflict_problems(&names));

    Ok(if problems.is_empty() {
        AppDocumentPlan::Planned(documents)
    } else {
        AppDocumentPlan::Refused(problems)
    })
}

/// Each merged document of the root with what each app it covers contributes: a server entry's
/// apis, else an OpenAPI-only app's listed documents; an app with no server target and some
/// target contributes nothing. `roles_by_app` holds each app's entry roles, by the app's name.
///
/// # Errors
///
/// [`CliConfigError::Internal`] when a merged document names an app the workspace lacks, or an
/// app with entries has no roles.
pub fn plan_merged_documents(
    workspace: &LoadedWorkspace,
    roles_by_app: &IndexMap<String, IndexMap<String, TargetRole>>,
) -> Result<MergedDocumentPlan, CliConfigError> {
    let mut documents = Vec::with_capacity(workspace.root.openapi.len());

    for merged in &workspace.root.openapi {
        let mut contributions = Vec::new();

        for app_name in &merged.apps {
            let app = workspace
                .apps
                .iter()
                .find(|each| &each.app.name == app_name)
                .ok_or_else(|| {
                    InternalError::new(format!("the workspace has no app {app_name}"))
                })?;

            contributions.extend(app_contributions(
                app_name,
                &app.config,
                roles_by_app.get(app_name),
            )?);
        }

        documents.push(PlannedMergedDocument {
            name: merged.name.clone(),
            file: merged.file.clone(),
            options: merged.options.clone(),
            prefix: merged.prefix.clone(),
            contributions,
        });
    }

    let names: Vec<NamedFile<'_>> = documents
        .iter()
        .map(|each| NamedFile {
            file: each.file.as_str(),
            name: each.name.clone(),
        })
        .collect();
    let problems = path_conflict_problems(&names);

    Ok(if problems.is_empty() {
        MergedDocumentPlan::Planned(documents)
    } else {
        MergedDocumentPlan::Refused(problems)
    })
}

/// A document's file and the name its problems give it.
struct NamedFile<'document> {
    file: &'document str,
    name: String,
}

/// An api served by one or more entries, and the operations they restrict it to.
struct ServedApi<'documents> {
    api: &'documents ApiDocuments,
    /// `None` when an entry serves the whole api.
    operations: Option<Vec<OperationsFilter>>,
}

fn name_of(document: &PlannedAppDocument) -> String {
    match &document.document {
        None => document.api.clone(),
        Some(name) => format!("{}.{name}", document.api),
    }
}

fn role_of(
    entry_roles: &IndexMap<String, TargetRole>,
    entry_id: &str,
) -> Result<TargetRole, InternalError> {
    entry_roles.get(entry_id).copied().ok_or_else(|| {
        InternalError::new(format!("no resolved target role for the entry {entry_id}"))
    })
}

fn empty_options() -> JsonValue {
    JsonValue::Object(JsonObject::new())
}

fn default_documents(
    config: &LoadedAppConfig,
    entry_roles: &IndexMap<String, TargetRole>,
    api_documents: &[ApiDocuments],
) -> Result<AppDocumentPlan, CliConfigError> {
    let directory = default_document_directory(config);
    let mut served: IndexMap<(&str, &str), ServedApi<'_>> = IndexMap::new();
    let mut problems = Vec::new();
    let settings = config.target_entries()?;

    for (raw, configured) in config.entries.iter().zip(&settings) {
        let entry = &configured.settings;

        if role_of(entry_roles, &entry.id)? != TargetRole::Server {
            continue;
        }

        for text in api_refs_of(&raw.entry) {
            let where_ = format!("entry '{}'", entry.id);

            match find_api(api_documents, text, where_) {
                Ok(api) => add_served_api(&mut served, api, entry.operations.as_ref()),
                Err(problem) => problems.push(*problem),
            }
        }
    }

    if !problems.is_empty() {
        return Ok(AppDocumentPlan::Refused(problems));
    }

    let documents = served
        .into_values()
        .flat_map(|each| default_documents_of_api(&directory, &each))
        .collect();

    Ok(AppDocumentPlan::Planned(documents))
}

fn default_documents_of_api(
    directory: &Utf8Path,
    served: &ServedApi<'_>,
) -> Vec<PlannedAppDocument> {
    let api = served.api;
    let planned = |document: Option<&String>, file_name: String| PlannedAppDocument {
        source: api.source.clone(),
        api: api.api.clone(),
        document: document.cloned(),
        file: joined_path(directory, Utf8Path::new(&file_name)),
        options: empty_options(),
        served_operations: served.operations.clone(),
    };

    if api.documents.is_empty() {
        return vec![planned(None, format!("{}{DOCUMENT_EXTENSION}", api.api))];
    }

    api.documents
        .iter()
        .map(|document| {
            planned(
                Some(document),
                format!("{}.{document}{DOCUMENT_EXTENSION}", api.api),
            )
        })
        .collect()
}

fn add_served_api<'documents>(
    served: &mut IndexMap<(&'documents str, &'documents str), ServedApi<'documents>>,
    api: &'documents ApiDocuments,
    operations: Option<&OperationsFilter>,
) {
    let key = (api.source.as_str(), api.api.as_str());
    let known = served.get(&key);
    let known_serves_whole_api = known.is_some_and(|each| each.operations.is_none());

    let Some(operations) = operations.filter(|_| !known_serves_whole_api) else {
        served.insert(
            key,
            ServedApi {
                api,
                operations: None,
            },
        );

        return;
    };
    let mut all = known
        .and_then(|each| each.operations.clone())
        .unwrap_or_default();

    all.push(operations.clone());
    served.insert(
        key,
        ServedApi {
            api,
            operations: Some(all),
        },
    );
}

fn listed_documents(
    config: &LoadedAppConfig,
    openapi: &JsonValue,
    api_documents: &[ApiDocuments],
) -> Result<AppDocumentPlan, CliConfigError> {
    if text_of(Some(openapi)) == Some(NO_OPENAPI_DOCUMENTS) {
        return Ok(AppDocumentPlan::Planned(Vec::new()));
    }

    let object = object_of(Some(openapi)).ok_or_else(|| {
        InternalError::new("an `openapi` that passed the schema is not a mapping")
    })?;
    let directory = directory_of(&config.file);
    let mut documents = Vec::new();
    let mut problems = Vec::new();

    for (api_name, placements) in js_key_order(object.iter()) {
        let found = match find_api(api_documents, api_name, format!("openapi.{api_name}")) {
            Ok(api) => api,
            Err(problem) => {
                problems.push(*problem);

                continue;
            }
        };

        match api_placements(&directory, found, placements)? {
            AppDocumentPlan::Planned(planned) => documents.extend(planned),
            AppDocumentPlan::Refused(refused) => problems.extend(refused),
        }
    }

    Ok(if problems.is_empty() {
        AppDocumentPlan::Planned(documents)
    } else {
        AppDocumentPlan::Refused(problems)
    })
}

fn find_api<'documents>(
    api_documents: &'documents [ApiDocuments],
    text: &str,
    where_: String,
) -> Result<&'documents ApiDocuments, Box<CliProblem>> {
    let reference = parse_api_ref(text);
    let candidates: Vec<&ApiDocuments> = api_documents
        .iter()
        .filter(|each| {
            each.api == reference.api && reference.source.is_none_or(|source| each.source == source)
        })
        .collect();

    if candidates.len() > 1 {
        let sources: Vec<String> = candidates
            .iter()
            .map(|each| format!("'{}'", each.source))
            .collect();

        return Err(Box::new(located_problem(
            "config.openapi.ambiguous-api",
            format!(
                "The api '{}' exists in the sources {}, and 'openapi' names an api alone.",
                reference.api,
                sources.join(", ")
            ),
            "An `openapi` key names an api alone: rename the api in the `workspace.yaml` of one of these sources, or remove one of them from the config that defines it (this app config or its root config).",
            where_,
        )));
    }

    candidates.first().copied().ok_or_else(|| {
        Box::new(located_problem(
            "config.openapi.unknown-api",
            format!("No source of the app config holds an api '{text}'."),
            "Name an api of a source's `workspace.yaml`.",
            where_,
        ))
    })
}

/// A placement is one when it is a path or an object with a `path`; else it maps document ids.
fn is_one_placement(placements: &JsonValue) -> bool {
    matches!(placements, JsonValue::String(_))
        || text_of(object_of(Some(placements)).and_then(|object| object.get("path"))).is_some()
}

fn placed(
    directory: &Utf8Path,
    placement: &JsonValue,
) -> Result<(Utf8PathBuf, JsonValue), InternalError> {
    if let JsonValue::String(path) = placement {
        return Ok((resolved_path(directory, path), empty_options()));
    }

    let object = object_of(Some(placement));
    let path = text_of(object.and_then(|object| object.get("path"))).ok_or_else(|| {
        InternalError::new("a document placement that passed the schema has no path")
    })?;
    let options = object.map_or_else(empty_options, document_options_of);

    Ok((resolved_path(directory, path), options))
}

fn api_placements(
    directory: &Utf8Path,
    api: &ApiDocuments,
    placements: &JsonValue,
) -> Result<AppDocumentPlan, InternalError> {
    let where_ = format!("openapi.{}", api.api);
    let declared = api.documents.join(", ");

    if is_one_placement(placements) {
        if api.documents.len() > 1 {
            let first = api.documents.first().map_or("", String::as_str);

            return Ok(refused(located_problem(
                "config.openapi.document-needed",
                format!(
                    "The api '{0}' declares the documents {declared}, and 'openapi.{0}' gives one path.",
                    api.api
                ),
                &format!(
                    "Map each document to its path: '{0}: {{ {first}: openapi/{0}.{first}.yaml }}'.",
                    api.api
                ),
                where_,
            )));
        }

        let (file, options) = placed(directory, placements)?;

        return Ok(AppDocumentPlan::Planned(vec![PlannedAppDocument {
            source: api.source.clone(),
            api: api.api.clone(),
            document: api.documents.first().cloned(),
            file,
            options,
            served_operations: None,
        }]));
    }

    if api.documents.is_empty() {
        return Ok(refused(located_problem(
            "config.openapi.no-documents",
            format!(
                "The api '{0}' declares no `documents`, and 'openapi.{0}' maps document ids.",
                api.api
            ),
            "Give the path of the api's one document instead of a mapping.",
            where_,
        )));
    }

    let object = object_of(Some(placements)).ok_or_else(|| {
        InternalError::new("a document placement that passed the schema is not a mapping")
    })?;
    let ordered: Vec<(&String, &JsonValue)> = js_key_order(object.iter()).collect();
    let unknown: Vec<CliProblem> = ordered
        .iter()
        .filter(|(document, _)| !api.documents.contains(document))
        .map(|(document, _)| {
            located_problem(
                "config.openapi.unknown-document",
                format!(
                    "The api '{}' declares no document '{document}' ({declared}).",
                    api.api
                ),
                "Map the documents the api's `documents` declares.",
                format!("{where_}.{document}"),
            )
        })
        .collect();

    if !unknown.is_empty() {
        return Ok(AppDocumentPlan::Refused(unknown));
    }

    let mut documents = Vec::with_capacity(ordered.len());

    for (document, placement) in ordered {
        let (file, options) = placed(directory, placement)?;

        documents.push(PlannedAppDocument {
            source: api.source.clone(),
            api: api.api.clone(),
            document: Some(document.clone()),
            file,
            options,
            served_operations: None,
        });
    }

    Ok(AppDocumentPlan::Planned(documents))
}

fn refused(problem: CliProblem) -> AppDocumentPlan {
    AppDocumentPlan::Refused(vec![problem])
}

fn document_inside_output_problems(
    config: &LoadedAppConfig,
    documents: &[PlannedAppDocument],
) -> Result<Vec<CliProblem>, InternalError> {
    let entries = config.target_entries()?;
    let mut problems = Vec::new();

    for document in documents {
        for configured in &entries {
            if !is_inside_or_equal(&configured.root, &document.file) {
                continue;
            }

            problems.push(located_problem(
                "config.openapi.inside-output",
                format!(
                    "The document {} lies inside the output directory of the entry '{}'.",
                    document.file, configured.settings.id
                ),
                "Write the document outside every entry's `out` directory, as the default `openapi/` does.",
                format!("openapi.{}", name_of(document)),
            ));
        }
    }

    Ok(problems)
}

fn path_conflict_problems(documents: &[NamedFile<'_>]) -> Vec<CliProblem> {
    documents
        .iter()
        .enumerate()
        .filter_map(|(index, document)| {
            let first = documents
                .iter()
                .take(index)
                .find(|other| other.file == document.file)?;

            Some(located_problem(
                "config.openapi.path-conflict",
                format!(
                    "The documents '{}' and '{}' are both written to {}.",
                    first.name, document.name, document.file
                ),
                "Give each document its own path.",
                format!("openapi.{}", document.name),
            ))
        })
        .collect()
}

fn app_contributions(
    app_name: &str,
    config: &LoadedAppConfig,
    entry_roles: Option<&IndexMap<String, TargetRole>>,
) -> Result<Vec<MergedContribution>, InternalError> {
    if !config.entries.is_empty() {
        let roles = entry_roles
            .ok_or_else(|| InternalError::new(format!("no entry roles for the app {app_name}")))?;
        let mut contributions = Vec::new();

        for (raw, configured) in config.entries.iter().zip(config.target_entries()?) {
            let entry = configured.settings;

            if role_of(roles, &entry.id)? != TargetRole::Server {
                continue;
            }

            contributions.extend(api_refs_of(&raw.entry).into_iter().map(|api| {
                MergedContribution {
                    app: app_name.to_owned(),
                    api: api.to_owned(),
                    entry: Some(entry.id.clone()),
                    document: entry.document.clone(),
                    operations: entry.operations.clone(),
                }
            }));
        }

        return Ok(contributions);
    }

    let Some(openapi) = &config.openapi else {
        return Ok(Vec::new());
    };

    if text_of(Some(openapi)) == Some(NO_OPENAPI_DOCUMENTS) {
        return Ok(Vec::new());
    }

    let object = object_of(Some(openapi)).ok_or_else(|| {
        InternalError::new("an `openapi` that passed the schema is not a mapping")
    })?;
    let mut contributions = Vec::new();

    for (api, placements) in js_key_order(object.iter()) {
        let contribution = |document: Option<String>| MergedContribution {
            app: app_name.to_owned(),
            api: api.clone(),
            entry: None,
            document,
            operations: None,
        };

        if is_one_placement(placements) {
            contributions.push(contribution(None));

            continue;
        }

        let documents = object_of(Some(placements)).ok_or_else(|| {
            InternalError::new("a document placement that passed the schema is not a mapping")
        })?;

        contributions.extend(
            js_key_order(documents.keys().map(|document| (document, ())))
                .map(|(document, ())| contribution(Some(document.clone()))),
        );
    }

    Ok(contributions)
}
