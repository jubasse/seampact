//! The recorded calls of the bundle fetch: `fetchBundle` and `compileWorkspaceWithImports`
//! replayed on the case root, their results written as `JSON.stringify` writes them.

use std::fs;
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle::BundleSource;
use seampact_bundle_fetch::{
    BundleFetchOptions, BundleFetchResult, BundleSourceFailure, LocalSourcePolicy, ReleaseGet,
    ReleaseGetError, ReleaseResponse, Url, WorkspaceImportFailure, WorkspaceImportsOptions,
    WorkspaceImportsResult, compile_workspace_with_imports, fetch_bundle,
};
use seampact_cli_config::bundle_source_of;
use seampact_compiler::{PipelineApiResult, PipelineOptions, PipelineResult};
use seampact_diagnostics::diagnostic_list_json;
use seampact_ir::SourceMap;
use seampact_json::{JsonNumber, JsonObject, JsonValue, canonical_document};
use seampact_load::{FsReader, LoadOptions};
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};
use seampact_pipeline::PipelineDeclared;
use seampact_span::{Location, SourceFiles};

const FETCH_BUNDLE: &str = "fetchBundle";
const COMPILE_WORKSPACE_WITH_IMPORTS: &str = "compileWorkspaceWithImports";
/// Where both harnesses point `SEAMPACT_CACHE_DIR` when a case does not.
const CASE_CACHE_DIRECTORY: &str = ".cache";

/// The release channel of a replayed call: no case reaches the network.
struct NoNetwork;

impl ReleaseGet for NoNetwork {
    fn get(&self, _url: &Url, _timeout: Duration) -> Result<ReleaseResponse, ReleaseGetError> {
        Err(ReleaseGetError::Failed(
            "the oracle's recorded calls reach no network".to_owned(),
        ))
    }
}

/// Replays a recorded call of the bundle fetch on the case root.
pub(super) fn bundle_fetch_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    match replay(call, root) {
        Ok(answer) => SubjectAnswer::Ported(answer),
        Err(message) => SubjectAnswer::InternalError { message },
    }
}

fn replay(call: &RecordedToolCall, root: &Utf8Path) -> Result<RecordedAnswer, String> {
    let cache = root.join(CASE_CACHE_DIRECTORY);
    let result = match call.function.as_str() {
        FETCH_BUNDLE => fetch_result(call, root, &cache)?,
        COMPILE_WORKSPACE_WITH_IMPORTS => compile_result(call, root, &cache)?,
        other => {
            return Err(format!(
                "'{other}' is no recorded function of the bundle fetch"
            ));
        }
    };

    Ok(RecordedAnswer {
        result,
        written: written_files(root, &cache)?,
    })
}

fn fetch_result(
    call: &RecordedToolCall,
    root: &Utf8Path,
    cache: &Utf8Path,
) -> Result<JsonValue, String> {
    let [source, options] = call.args.as_slice() else {
        return Err("fetchBundle is recorded with a source and its options".to_owned());
    };
    let source = source_of(source)?;
    let options = fetch_options_of(options, root, cache, &NoNetwork)?;
    let fetched = fetch_bundle(&source, &options).map_err(|error| error.to_string())?;

    fetch_result_json(&fetched)
}

fn compile_result(
    call: &RecordedToolCall,
    root: &Utf8Path,
    cache: &Utf8Path,
) -> Result<JsonValue, String> {
    let [JsonValue::Object(options)] = call.args.as_slice() else {
        return Err("compileWorkspaceWithImports is recorded with one options object".to_owned());
    };
    let reader_root = member_text(object_member(options, "reader")?, "root")?;
    let entry = member_text(options, "entry")?;
    let fetch = fetch_options_of(
        &JsonValue::Object(object_member(options, "fetch")?.clone()),
        root,
        cache,
        &NoNetwork,
    )?;
    let reader = FsReader::new(&Utf8PathBuf::from(under_root(reader_root, root)))
        .map_err(|error| error.to_string())?;
    let no_imports = IndexMap::new();
    let compiled = compile_workspace_with_imports(&WorkspaceImportsOptions {
        pipeline: PipelineOptions {
            load: LoadOptions {
                reader: &reader,
                entry,
            },
            imports: &no_imports,
        },
        fetch,
    })
    .map_err(|error| error.to_string())?;

    match compiled {
        WorkspaceImportsResult::Compiled(result) => Ok(members(vec![
            ("ok", JsonValue::Bool(true)),
            ("compiled", compiled_json(&result)?),
        ])),
        WorkspaceImportsResult::Failed(failures) => Ok(members(vec![
            ("ok", JsonValue::Bool(false)),
            (
                "failures",
                JsonValue::Array(failures.iter().map(import_failure_json).collect()),
            ),
        ])),
    }
}

fn members(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn text(value: &str) -> JsonValue {
    JsonValue::String(value.to_owned())
}

fn under_root(path: &str, root: &Utf8Path) -> String {
    path.replace(ROOT_TOKEN, root.as_str())
}

fn object_member<'object>(
    object: &'object JsonObject,
    key: &str,
) -> Result<&'object JsonObject, String> {
    match object.get(key) {
        Some(JsonValue::Object(member)) => Ok(member),
        _ => Err(format!("the recorded call holds an object '{key}'")),
    }
}

fn member_text<'object>(object: &'object JsonObject, key: &str) -> Result<&'object str, String> {
    optional_text(object, key).ok_or_else(|| format!("the recorded call holds a text '{key}'"))
}

fn optional_text<'object>(object: &'object JsonObject, key: &str) -> Option<&'object str> {
    match object.get(key) {
        Some(JsonValue::String(value)) => Some(value),
        _ => None,
    }
}

fn source_of(value: &JsonValue) -> Result<BundleSource, String> {
    bundle_source_of(value).map_err(|error| error.to_string())
}

fn fetch_options_of<'run>(
    value: &JsonValue,
    root: &Utf8Path,
    cache: &Utf8Path,
    release_get: &'run dyn ReleaseGet,
) -> Result<BundleFetchOptions<'run>, String> {
    let JsonValue::Object(options) = value else {
        return Err("the recorded fetch options are an object".to_owned());
    };
    let local_sources = match member_text(options, "localSources")? {
        "allow" => LocalSourcePolicy::Allow,
        "refuse" => LocalSourcePolicy::Refuse,
        other => return Err(format!("'{other}' is no recorded local source policy")),
    };

    Ok(BundleFetchOptions {
        base_directory: Utf8PathBuf::from(under_root(member_text(options, "baseDirectory")?, root)),
        local_sources,
        cache_directory: Some(optional_text(options, "cacheDirectory").map_or_else(
            || cache.to_path_buf(),
            |path| Utf8PathBuf::from(under_root(path, root)),
        )),
        release_get,
    })
}

/// Every file below the cache directory, by path relative to the run root: the call's writes.
fn written_files(root: &Utf8Path, cache: &Utf8Path) -> Result<IndexMap<String, Vec<u8>>, String> {
    let mut written = Vec::new();

    if cache.exists() {
        collect_files(root, cache, &mut written)?;
    }

    written.sort_by(|left, right| left.0.cmp(&right.0));

    Ok(written.into_iter().collect())
}

fn collect_files(
    root: &Utf8Path,
    directory: &Utf8Path,
    written: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), String> {
    for child in directory
        .read_dir_utf8()
        .map_err(|error| error.to_string())?
    {
        let child = child.map_err(|error| error.to_string())?;
        let path = child.path();

        if child
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_files(root, path, written)?;
        } else {
            let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;

            written.push((
                relative.as_str().to_owned(),
                fs::read(path).map_err(|error| error.to_string())?,
            ));
        }
    }

    Ok(())
}

fn fetch_result_json(result: &BundleFetchResult) -> Result<JsonValue, String> {
    match result {
        BundleFetchResult::Fetched {
            manifest,
            integrity,
            irs,
        } => {
            let mut documents = JsonObject::new();

            for (name, ir) in irs {
                let document = ir.to_json_value().map_err(|error| error.to_string())?;

                documents.insert(name.clone(), in_document_order(&document)?);
            }

            Ok(members(vec![
                ("ok", JsonValue::Bool(true)),
                ("manifest", in_document_order(&manifest.to_json_value())?),
                ("integrity", text(integrity)),
                ("irs", JsonValue::Object(documents)),
            ]))
        }
        BundleFetchResult::Failed {
            failures,
            integrity,
        } => {
            let mut entries = vec![
                ("ok", JsonValue::Bool(false)),
                ("failures", failures_json(failures)),
            ];

            if let Some(integrity) = integrity {
                entries.push(("integrity", text(integrity)));
            }

            Ok(members(entries))
        }
    }
}

/// The value as a bundle file holds it once read: every object's members in the canonical
/// document order, which the verifier's `JSON.parse` of the file keeps.
fn in_document_order(value: &JsonValue) -> Result<JsonValue, String> {
    serde_json::from_str(&canonical_document(value)).map_err(|error| error.to_string())
}

fn failures_json(failures: &[BundleSourceFailure]) -> JsonValue {
    JsonValue::Array(failures.iter().map(failure_json).collect())
}

fn failure_json(failure: &BundleSourceFailure) -> JsonValue {
    let mut entries = vec![
        ("code", text(failure.code.as_str())),
        ("message", text(&failure.message)),
        ("fix", text(&failure.fix)),
    ];

    for (name, value) in [
        ("file", &failure.file),
        ("expected", &failure.expected),
        ("actual", &failure.actual),
    ] {
        if let Some(value) = value {
            entries.push((name, text(value)));
        }
    }

    members(entries)
}

fn import_failure_json(failure: &WorkspaceImportFailure) -> JsonValue {
    members(vec![
        ("name", text(&failure.name)),
        ("failures", failures_json(&failure.failures)),
    ])
}

fn compiled_json(result: &PipelineResult) -> Result<JsonValue, String> {
    let apis = result
        .apis
        .iter()
        .map(|api| api_json(api, &result.source_files))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(members(vec![
        (
            "files",
            JsonValue::Array(result.read_files.iter().map(|file| text(file)).collect()),
        ),
        ("diagnostics", diagnostic_list_json(&result.diagnostics)),
        (
            "locations",
            locations_json(&result.source_files, &result.locations)?,
        ),
        ("apis", JsonValue::Array(apis)),
    ]))
}

fn api_json(api: &PipelineApiResult, files: &SourceFiles) -> Result<JsonValue, String> {
    let mut entries = vec![
        ("api", text(&api.api)),
        ("diagnostics", diagnostic_list_json(&api.diagnostics)),
        ("locations", locations_json(files, &api.locations)?),
    ];

    if let Some(ir) = &api.ir {
        let document = ir.to_json_value().map_err(|error| error.to_string())?;

        entries.push(("ir", in_document_order(&document)?));
    }

    if let Some(source_map) = &api.source_map {
        entries.push((
            "sourceMap",
            in_document_order(&source_map_json(source_map))?,
        ));
    }

    if let Some(declared) = &api.declared {
        entries.push((
            "declared",
            JsonValue::Array(declared.iter().map(declared_json).collect()),
        ));
    }

    Ok(members(entries))
}

fn locations_json(
    files: &SourceFiles,
    spans: &seampact_authoring::Locations,
) -> Result<JsonValue, String> {
    let located = files.locations(spans).map_err(|error| error.to_string())?;

    Ok(JsonValue::Object(
        located
            .iter()
            .map(|(key, location)| (key.clone(), location_json(location)))
            .collect(),
    ))
}

fn location_json(location: &Location) -> JsonValue {
    members(vec![
        ("file", text(&location.file)),
        ("line", number(i64::from(location.line))),
        ("column", number(i64::from(location.column))),
        ("endLine", number(i64::from(location.end_line))),
        ("endColumn", number(i64::from(location.end_column))),
    ])
}

fn number(value: i64) -> JsonValue {
    JsonValue::Number(JsonNumber::from_i64(value))
}

fn source_map_json(map: &SourceMap) -> JsonValue {
    members(vec![
        ("irRevision", number(map.ir_revision)),
        (
            "locations",
            JsonValue::Object(
                map.locations
                    .iter()
                    .map(|(key, location)| {
                        (
                            key.clone(),
                            members(vec![
                                ("file", text(&location.file)),
                                ("line", number(location.line)),
                                ("column", number(location.column)),
                                ("endLine", number(location.end_line)),
                                ("endColumn", number(location.end_column)),
                            ]),
                        )
                    })
                    .collect(),
            ),
        ),
    ])
}

fn declared_json(declared: &PipelineDeclared) -> JsonValue {
    let mut origin = Vec::new();

    if let Some(api) = &declared.origin.api {
        origin.push(("api", text(api)));
    }

    origin.push(("layer", text(&declared.origin.layer.to_string())));
    origin.push(("pointer", text(&declared.origin.pointer)));

    members(vec![
        ("catalogue", text(declared.catalogue)),
        ("id", text(&declared.id)),
        ("origin", members(origin)),
        ("reached", JsonValue::Bool(declared.reached)),
    ])
}
