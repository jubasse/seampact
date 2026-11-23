//! The merged documents of a root: each with what the apps it covers contribute.

use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;

use crate::document_plan::{NamedFile, path_conflict_problems};
use crate::open_api_settings::ApiPlacements;
use crate::operations_filter::OperationsFilter;
use crate::problems::Problems;
use crate::read_app_config::LoadedAppConfig;
use crate::read_root_config::LoadedRootConfig;
use crate::target_entry_settings::TargetEntrySettings;
use camino::Utf8PathBuf;

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

/// An app of a root with the entries of its server targets.
#[derive(Debug, Clone)]
pub struct MergedApp<'run> {
    /// The app's name in the root's `apps`.
    pub name: &'run str,
    /// The app's config.
    pub config: &'run LoadedAppConfig,
    /// The entries whose target serves an api, in config order.
    pub server_entries: Vec<&'run TargetEntrySettings>,
}

/// Why the merged documents are not planned.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum MergedPlanError {
    /// The documents the plan refuses.
    #[error("the merged documents are refused")]
    Refused(Problems),
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}

impl From<Problems> for MergedPlanError {
    fn from(problems: Problems) -> Self {
        Self::Refused(problems)
    }
}

/// Each merged document of the root with what each app it covers contributes: a server entry's
/// apis, else an OpenAPI-only app's listed documents; an app with no server target and some
/// target contributes nothing.
///
/// # Errors
///
/// [`MergedPlanError::Refused`] when two documents share a file, [`MergedPlanError::Internal`]
/// when a merged document names an app `apps` lacks.
pub fn plan_merged_documents(
    root: &LoadedRootConfig,
    apps: &[MergedApp<'_>],
) -> Result<Vec<PlannedMergedDocument>, MergedPlanError> {
    let mut documents = Vec::with_capacity(root.openapi.len());

    for merged in &root.openapi {
        let mut contributions = Vec::new();

        for app_name in &merged.apps {
            let app = apps
                .iter()
                .find(|each| each.name == app_name)
                .ok_or_else(|| InternalError::new(format!("the run has no app {app_name}")))?;

            contributions.extend(app_contributions(app));
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

    Problems::refuse_any(path_conflict_problems(&names))?;

    Ok(documents)
}

fn app_contributions(app: &MergedApp<'_>) -> Vec<MergedContribution> {
    if !app.config.entries.is_empty() {
        return app
            .server_entries
            .iter()
            .flat_map(|entry| {
                entry.api_refs().into_iter().map(|api| MergedContribution {
                    app: app.name.to_owned(),
                    api: api.to_owned(),
                    entry: Some(entry.id.clone()),
                    document: entry.document.clone(),
                    operations: entry.operations.clone(),
                })
            })
            .collect();
    }

    let Some(openapi) = &app.config.openapi else {
        return Vec::new();
    };

    openapi
        .apis
        .iter()
        .flat_map(|(api, placements)| {
            let documents: Vec<Option<String>> = match placements {
                ApiPlacements::One(_) => vec![None],
                ApiPlacements::ByDocument(by_document) => {
                    by_document.keys().cloned().map(Some).collect()
                }
            };

            documents.into_iter().map(|document| MergedContribution {
                app: app.name.to_owned(),
                api: api.clone(),
                entry: None,
                document,
                operations: None,
            })
        })
        .collect()
}
