//! A workspace compiled with the apis it imports from pinned bundles.
//!
//! Each `workspace.imports` entry's bundle is fetched and put through the pinned-bundle check, its
//! `api` looked up in the manifest, and the IR passed to the compiler as an import under the
//! entry's name, so a relay reads it as it reads a sibling api. An entry the workspace schema
//! refuses (no source form, or more than one) is not fetched: the compilation reports it.

use indexmap::IndexMap;
use seampact_bundle::{BundleSource, written_bundle_source};
use seampact_compiler::{PipelineOptions, PipelineResult, compile_workspace};
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::ImportedIr;
use seampact_json::JsonValue;
use seampact_load::{LoadOptions, load_workspace};

use crate::fetch_failure::bundle_source_text;
use crate::{
    BundleFetchError, BundleFetchOptions, BundleFetchResult, BundleSourceFailure,
    BundleSourceFailureCode, fetch_bundle,
};

/// Why a workspace import cannot be fetched.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceImportFailure {
    /// The entry's name in `workspace.imports`.
    pub name: String,
    /// What stops the entry's bundle.
    pub failures: Vec<BundleSourceFailure>,
}

/// What a workspace with imports is compiled from.
pub struct WorkspaceImportsOptions<'run> {
    /// The compile options; their `imports` are replaced by the fetched bundles.
    pub pipeline: PipelineOptions<'run>,
    /// How the bundles are fetched: `base_directory` is the workspace root.
    pub fetch: BundleFetchOptions<'run>,
}

impl std::fmt::Debug for WorkspaceImportsOptions<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkspaceImportsOptions")
            .field("fetch", &self.fetch)
            .finish_non_exhaustive()
    }
}

/// The compilation, or the import failures that stop it.
#[derive(Debug, Clone)]
pub enum WorkspaceImportsResult {
    /// The `compiled` member.
    Compiled(Box<PipelineResult>),
    /// The `failures` member.
    Failed(Vec<WorkspaceImportFailure>),
}

#[derive(Debug)]
struct DeclaredImport {
    name: String,
    api: String,
    source: BundleSource,
}

/// What an import's bundle gave: the api's IR, or why there is none.
enum ImportedApi {
    Ir(Box<ImportedIr>),
    Failed(Vec<BundleSourceFailure>),
}

/// Fetches the workspace's imports, then compiles it with them.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when a bundle cannot be read or written, [`BundleFetchError::Internal`]
/// for a bug of the compiler or of the fetch.
pub fn compile_workspace_with_imports(
    options: &WorkspaceImportsOptions<'_>,
) -> Result<WorkspaceImportsResult, BundleFetchError> {
    let loaded = load_workspace(&options.pipeline.load)?;
    let declared = declared_imports(
        loaded
            .workspace
            .config
            .as_ref()
            .and_then(|config| config.imports.as_ref()),
    );

    if declared.is_empty() {
        return Ok(WorkspaceImportsResult::Compiled(Box::new(
            compile_workspace(&options.pipeline)?,
        )));
    }

    let mut imports: IndexMap<String, ImportedIr> = options.pipeline.imports.clone();
    let mut failures: Vec<WorkspaceImportFailure> = Vec::new();

    for each in &declared {
        match imported_ir(each, &options.fetch)? {
            ImportedApi::Failed(import_failures) => failures.push(WorkspaceImportFailure {
                name: each.name.clone(),
                failures: import_failures,
            }),
            ImportedApi::Ir(ir) => {
                imports.insert(each.name.clone(), *ir);
            }
        }
    }

    if !failures.is_empty() {
        return Ok(WorkspaceImportsResult::Failed(failures));
    }

    let pipeline = PipelineOptions {
        load: LoadOptions {
            reader: options.pipeline.load.reader,
            entry: options.pipeline.load.entry,
        },
        imports: &imports,
    };

    Ok(WorkspaceImportsResult::Compiled(Box::new(
        compile_workspace(&pipeline)?,
    )))
}

fn imported_ir(
    declared: &DeclaredImport,
    fetch_options: &BundleFetchOptions<'_>,
) -> Result<ImportedApi, BundleFetchError> {
    let (manifest, irs) = match fetch_bundle(&declared.source, fetch_options)? {
        BundleFetchResult::Failed { failures, .. } => return Ok(ImportedApi::Failed(failures)),
        BundleFetchResult::Fetched { manifest, irs, .. } => (manifest, irs),
    };

    if let Some(ir) = irs.get(&declared.api) {
        let text = ir.canonical_text().map_err(|error| ir_error(&error))?;

        return Ok(ImportedApi::Ir(Box::new(
            ImportedIr::from_json_text(&text).map_err(|error| ir_error(&error))?,
        )));
    }

    let apis = manifest
        .apis
        .iter()
        .map(|api| quote_text(&api.name))
        .collect::<Vec<_>>()
        .join(", ");

    Ok(ImportedApi::Failed(vec![BundleSourceFailure::new(
        BundleSourceFailureCode::ImportApiMissing,
        format!(
            "The bundle of {} holds no api {}; it holds {apis}.",
            bundle_source_text(&declared.source),
            quote_text(&declared.api)
        ),
        &format!("Name one of the bundle's apis in the import's 'api' ({apis})."),
    )]))
}

/// An IR the check read does not encode or decode again: a bug.
fn ir_error(error: &seampact_ir::IrError) -> BundleFetchError {
    InternalError::new(format!(
        "bundle: a verified IR does not round-trip: {error}."
    ))
    .into()
}

/// The entries of `workspace.imports` whose shape the workspace schema accepts, in declaration
/// order.
fn declared_imports(imports: Option<&JsonValue>) -> Vec<DeclaredImport> {
    let Some(JsonValue::Object(imports)) = imports else {
        return Vec::new();
    };

    imports
        .iter()
        .filter_map(|(name, entry)| {
            let JsonValue::Object(members) = entry else {
                return None;
            };
            let Some(JsonValue::String(api)) = members.get("api") else {
                return None;
            };

            Some(DeclaredImport {
                name: name.clone(),
                api: api.clone(),
                source: written_bundle_source(entry)?,
            })
        })
        .collect()
}
