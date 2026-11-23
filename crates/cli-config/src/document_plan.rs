//! The documents an app config plans: those its `openapi` lists, else those of the apis its server
//! entries serve.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_json::JsonValue;

use crate::api_refs::parse_api_ref;
use crate::open_api_settings::{ApiPlacements, DocumentPlacement, OpenApiSettings, empty_options};
use crate::operations_filter::OperationsFilter;
use crate::path_containment::is_inside_or_equal;
use crate::problems::Problems;
use crate::read_app_config::LoadedAppConfig;
use crate::target_entry_settings::TargetEntrySettings;
use crate::{CliProblem, located_problem};
use seampact_paths::node_path;

/// The default directory of an app's documents, beside its config file.
const DEFAULT_DOCUMENT_DIRECTORY: &str = "openapi";

const DOCUMENT_EXTENSION: &str = ".yaml";

/// The api names the app's `openapi` maps to documents; none when it is absent or `none`.
#[must_use]
pub fn open_api_api_names(config: &LoadedAppConfig) -> Vec<&str> {
    config
        .openapi
        .iter()
        .flat_map(|settings| settings.apis.keys().map(String::as_str))
        .collect()
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

/// The default directory of an app's documents, beside its config file.
#[must_use]
pub fn default_document_directory(config: &LoadedAppConfig) -> Utf8PathBuf {
    node_path::join(
        &node_path::dirname(&config.file),
        Utf8Path::new(DEFAULT_DOCUMENT_DIRECTORY),
    )
}

/// The documents an app writes: those its `openapi` lists, none for `none`, and without the key
/// every document of every api its `server_entries` generate from, at `openapi/<api>.yaml` or
/// `openapi/<api>.<document>.yaml`.
///
/// # Errors
///
/// [`Problems`] when an api is unknown or ambiguous, a placement does not fit what the api
/// declares, a document lies inside an entry's output or two documents share a file.
pub fn plan_app_documents(
    config: &LoadedAppConfig,
    server_entries: &[&TargetEntrySettings],
    api_documents: &[ApiDocuments],
) -> Result<Vec<PlannedAppDocument>, Problems> {
    let documents = match &config.openapi {
        None => default_documents(config, server_entries, api_documents)?,
        Some(openapi) => listed_documents(openapi, api_documents)?,
    };
    let names: Vec<NamedFile<'_>> = documents
        .iter()
        .map(|each| NamedFile {
            file: each.file.as_str(),
            name: name_of(each),
        })
        .collect();
    let mut problems = document_inside_output_problems(config, &documents);

    problems.extend(path_conflict_problems(&names));
    Problems::refuse_any(problems)?;

    Ok(documents)
}

/// A document's file and the name its problems give it.
pub(crate) struct NamedFile<'document> {
    pub(crate) file: &'document str,
    pub(crate) name: String,
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

fn default_documents(
    config: &LoadedAppConfig,
    server_entries: &[&TargetEntrySettings],
    api_documents: &[ApiDocuments],
) -> Result<Vec<PlannedAppDocument>, Problems> {
    let directory = default_document_directory(config);
    let mut served: IndexMap<(&str, &str), ServedApi<'_>> = IndexMap::new();
    let mut problems = Vec::new();

    for entry in server_entries {
        for text in entry.api_refs() {
            let where_ = format!("entry '{}'", entry.id);

            match find_api(api_documents, text, where_) {
                Ok(api) => add_served_api(&mut served, api, entry.operations.as_ref()),
                Err(problem) => problems.push(*problem),
            }
        }
    }

    Problems::refuse_any(problems)?;

    Ok(served
        .into_values()
        .flat_map(|each| default_documents_of_api(&directory, &each))
        .collect())
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
        file: node_path::join(directory, Utf8Path::new(&file_name)),
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
    openapi: &OpenApiSettings,
    api_documents: &[ApiDocuments],
) -> Result<Vec<PlannedAppDocument>, Problems> {
    let mut documents = Vec::new();
    let mut problems = Vec::new();

    for (api_name, placements) in &openapi.apis {
        let found = match find_api(api_documents, api_name, format!("openapi.{api_name}")) {
            Ok(api) => api,
            Err(problem) => {
                problems.push(*problem);

                continue;
            }
        };

        match api_placements(found, placements) {
            Ok(planned) => documents.extend(planned),
            Err(refused) => problems.extend(refused),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(documents)
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

fn planned_document(
    api: &ApiDocuments,
    document: Option<String>,
    placement: &DocumentPlacement,
) -> PlannedAppDocument {
    PlannedAppDocument {
        source: api.source.clone(),
        api: api.api.clone(),
        document,
        file: placement.file.clone(),
        options: placement.options.clone(),
        served_operations: None,
    }
}

fn api_placements(
    api: &ApiDocuments,
    placements: &ApiPlacements,
) -> Result<Vec<PlannedAppDocument>, Problems> {
    let where_ = format!("openapi.{}", api.api);
    let declared = api.documents.join(", ");

    let by_document = match placements {
        ApiPlacements::One(placement) => {
            if api.documents.len() > 1 {
                let first = api.documents.first().map_or("", String::as_str);

                return Err(located_problem(
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
                )
                .into());
            }

            return Ok(vec![planned_document(
                api,
                api.documents.first().cloned(),
                placement,
            )]);
        }
        ApiPlacements::ByDocument(by_document) => by_document,
    };

    if api.documents.is_empty() {
        return Err(located_problem(
            "config.openapi.no-documents",
            format!(
                "The api '{0}' declares no `documents`, and 'openapi.{0}' maps document ids.",
                api.api
            ),
            "Give the path of the api's one document instead of a mapping.",
            where_,
        )
        .into());
    }

    let unknown: Vec<CliProblem> = by_document
        .keys()
        .filter(|document| !api.documents.contains(document))
        .map(|document| {
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

    Problems::refuse_any(unknown)?;

    Ok(by_document
        .iter()
        .map(|(document, placement)| planned_document(api, Some(document.clone()), placement))
        .collect())
}

fn document_inside_output_problems(
    config: &LoadedAppConfig,
    documents: &[PlannedAppDocument],
) -> Vec<CliProblem> {
    let mut problems = Vec::new();

    for document in documents {
        for configured in &config.entries {
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

    problems
}

pub(crate) fn path_conflict_problems(documents: &[NamedFile<'_>]) -> Vec<CliProblem> {
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
