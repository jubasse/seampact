//! A bundle built from a workspace.

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_compiler::{PipelineOptions, PipelineResult, compile_workspace};
use seampact_diagnostics::{InternalError, Severity, quote_text};
use seampact_finalize::finalize_serialize_ir;
use seampact_json::JsonValue;
use seampact_load::{
    LOAD_MAX_FILE_BYTES, LoadOptions, LoadReader, LoadText, load_workspace,
    pack_vendored_directory, package_name_of, split_pack_file,
};

use crate::file_list::compare_bundle_paths;
use crate::integrity::{bundle_integrity, bundle_sha256_hex};
use crate::label::bundle_label_problem;
use crate::path::{bundle_path_fold, bundle_path_problem};
use crate::recording_reader::RecordingReader;
use crate::ustar::ustar_path_split;
use crate::{
    BUNDLE_IR_DIRECTORY, BUNDLE_SOURCES_DIRECTORY, BundleApi, BundleContents, BundleError,
    BundleFailure, BundleFailureCode, BundleFile, BundleManifest, BundleNamedVersion,
};

const PACKAGE_MANIFEST: &str = "package.json";

/// The compiler named in the manifest: this crate's workspace version.
const COMPILER_NAME: &str = "seampact";

/// The contract's name and version, each over the workspace root `package.json`'s.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BundleNamedVersionOverride {
    /// The `name` member.
    pub name: Option<String>,
    /// The `version` member.
    pub version: Option<String>,
}

/// What a bundle is built from.
pub struct BundleBuildOptions<'run> {
    /// The reader the workspace is loaded through.
    pub reader: &'run dyn LoadReader,
    /// Root-relative path of the entry file, as `compile_workspace` takes it.
    pub entry: &'run str,
    /// The contract's name and version, over the workspace root `package.json`.
    pub contract: Option<BundleNamedVersionOverride>,
}

impl std::fmt::Debug for BundleBuildOptions<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BundleBuildOptions")
            .field("entry", &self.entry)
            .field("contract", &self.contract)
            .finish_non_exhaustive()
    }
}

/// The built bundle, or the failures that stop it.
#[derive(Debug, Clone)]
pub enum BundleBuildResult {
    /// The bundle's files and the compilation, whose diagnostics hold the warnings.
    Built {
        /// The `contents` member.
        contents: Box<BundleContents>,
        /// The `compiled` member.
        compiled: Box<PipelineResult>,
    },
    /// Why no bundle is built.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleFailure>,
        /// The compilation, when it failed: its diagnostics are the failure's detail.
        compiled: Option<Box<PipelineResult>>,
    },
}

fn failed(failures: Vec<BundleFailure>) -> BundleBuildResult {
    BundleBuildResult::Failed {
        failures,
        compiled: None,
    }
}

/// Builds the bundle of a workspace.
///
/// # Errors
///
/// [`BundleError::Internal`] for a bug: a stage that breaks its contract, an api with no error
/// and no IR.
pub fn build_bundle(options: &BundleBuildOptions<'_>) -> Result<BundleBuildResult, BundleError> {
    let recording = RecordingReader::new(options.reader);

    if let Some(failure) = workspace_imports_failure(&recording, options.entry)? {
        return Ok(failed(vec![failure]));
    }

    let compiled = compile_workspace(&PipelineOptions {
        load: LoadOptions {
            reader: &recording,
            entry: options.entry,
        },
        imports: &IndexMap::new(),
    })?;
    let error_count = compiled
        .diagnostics
        .iter()
        .chain(compiled.apis.iter().flat_map(|api| api.diagnostics.iter()))
        .filter(|diagnostic| diagnostic.severity == Severity::Error)
        .count();

    if error_count > 0 {
        return Ok(BundleBuildResult::Failed {
            failures: vec![compile_failure(error_count)],
            compiled: Some(Box::new(compiled)),
        });
    }

    let contract = contract_of(options);
    let sources = source_files(options.reader, &recording, &compiled.read_files);
    let irs = ir_files(&compiled)?;
    let labels = label_failures(contract.value.as_ref(), &irs.packs);
    let mut failures = contract.failures;

    failures.extend(sources.failures);
    failures.extend(irs.failures);
    failures.extend(labels);

    let Some(contract_value) = contract.value.filter(|_| failures.is_empty()) else {
        return Ok(failed(failures));
    };

    let mut files = sources.files;

    files.extend(irs.files);

    let mut listed: Vec<BundleFile> = files
        .iter()
        .map(|(path, bytes)| {
            Ok(BundleFile {
                path: path.clone(),
                size: u64::try_from(bytes.len())
                    .map_err(|_| InternalError::new("bundle: a file is larger than u64."))?,
                sha256: bundle_sha256_hex(bytes),
            })
        })
        .collect::<Result<_, InternalError>>()?;

    listed.sort_by(|left, right| compare_bundle_paths(&left.path, &right.path));

    let integrity = bundle_integrity(&listed);

    Ok(BundleBuildResult::Built {
        contents: Box::new(BundleContents {
            manifest: BundleManifest {
                contract: Box::new(contract_value),
                apis: irs.apis,
                compiler: Box::new(BundleNamedVersion {
                    name: COMPILER_NAME.to_owned(),
                    version: env!("CARGO_PKG_VERSION").to_owned(),
                }),
                packs: irs.packs,
                files: listed,
                integrity,
            },
            files,
        }),
        compiled: Box::new(compiled),
    })
}

fn workspace_imports_failure(
    reader: &dyn LoadReader,
    entry: &str,
) -> Result<Option<BundleFailure>, BundleError> {
    let loaded = load_workspace(&LoadOptions { reader, entry })?;
    let imports = loaded
        .workspace
        .config
        .as_ref()
        .and_then(|config| config.imports.as_ref());
    let Some(JsonValue::Object(imports)) = imports else {
        return Ok(None);
    };

    if imports.is_empty() {
        return Ok(None);
    }

    let names: Vec<String> = imports.keys().map(|name| quote_text(name)).collect();

    Ok(Some(
        BundleFailure::new(
            BundleFailureCode::ImportsUnsupported,
            format!(
                "The workspace imports {} from pinned bundles (workspace.imports); a bundle cannot carry the bundles it imports.",
                names.join(", ")
            ),
            "Bundle a workspace that compiles every api it relays to, without workspace.imports.",
        )
        .about(entry),
    ))
}

fn compile_failure(error_count: usize) -> BundleFailure {
    let plural = if error_count == 1 { "" } else { "s" };

    BundleFailure::new(
        BundleFailureCode::CompileFailed,
        format!(
            "The workspace does not compile: {error_count} error diagnostic{plural}; no bundle was written."
        ),
        "Fix the diagnostics `seampact compile` prints, then bundle again.",
    )
}

fn label_failures(
    contract: Option<&BundleNamedVersion>,
    packs: &[BundleNamedVersion],
) -> Vec<BundleFailure> {
    let mut labels: Vec<(String, &str)> = Vec::new();

    if let Some(contract) = contract {
        labels.push(("contract name".to_owned(), &contract.name));
        labels.push(("contract version".to_owned(), &contract.version));
    }

    for pack in packs {
        labels.push(("pack name".to_owned(), &pack.name));
        labels.push((
            format!("version of pack {}", quote_text(&pack.name)),
            &pack.version,
        ));
    }

    labels
        .into_iter()
        .filter_map(|(what, value)| {
            let problem = bundle_label_problem(value)?;

            Some(BundleFailure::new(
                BundleFailureCode::LabelInvalid,
                format!("The {what} {} {problem}; the manifest cannot hold it.", quote_text(value)),
                "Give the contract (package.json, or the passed name and version) and its packs names and versions of printable ASCII, at most 214 characters.",
            ))
        })
        .collect()
}

struct Gathered<T> {
    value: Option<T>,
    failures: Vec<BundleFailure>,
}

/// What `package.json` gave: nothing, the reason it is unreadable, or its members.
enum PackageManifest {
    Absent,
    Unreadable(String),
    Members(seampact_json::JsonObject),
}

fn read_package_manifest(reader: &dyn LoadReader, file: &str) -> PackageManifest {
    let Some(read) = reader.read_text(file, LOAD_MAX_FILE_BYTES) else {
        return PackageManifest::Absent;
    };

    let LoadText::Text(text) = read else {
        return PackageManifest::Unreadable(format!(
            "'{file}' is larger than {LOAD_MAX_FILE_BYTES} bytes"
        ));
    };

    match serde_json::from_str::<JsonValue>(&text) {
        Ok(JsonValue::Object(members)) => PackageManifest::Members(members),
        Ok(_) => PackageManifest::Unreadable(format!("'{file}' is not a JSON object")),
        Err(error) => {
            let message =
                seampact_js::json_parse_error_message(&text).unwrap_or_else(|| error.to_string());

            PackageManifest::Unreadable(format!("'{file}' is not JSON ({message})"))
        }
    }
}

fn non_empty_string(members: &seampact_json::JsonObject, key: &str) -> Option<String> {
    match members.get(key) {
        Some(JsonValue::String(text)) if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}

fn contract_of(options: &BundleBuildOptions<'_>) -> Gathered<BundleNamedVersion> {
    let manifest = read_package_manifest(options.reader, PACKAGE_MANIFEST);
    let (package_name, package_version, problem) = match &manifest {
        PackageManifest::Absent => (None, None, None),
        PackageManifest::Unreadable(problem) => (None, None, Some(problem.as_str())),
        PackageManifest::Members(members) => (
            non_empty_string(members, "name"),
            non_empty_string(members, "version"),
            None,
        ),
    };
    let overrides = options.contract.clone().unwrap_or_default();
    let name = overrides.name.or(package_name);
    let version = overrides.version.or(package_version);

    if let (Some(name), Some(version)) = (&name, &version) {
        return Gathered {
            value: Some(BundleNamedVersion {
                name: name.clone(),
                version: version.clone(),
            }),
            failures: Vec::new(),
        };
    }

    let mut missing = Vec::new();
    let mut missing_flags = Vec::new();

    if name.is_none() {
        missing.push("name");
        missing_flags.push("--name");
    }

    if version.is_none() {
        missing.push("version");
        missing_flags.push("--version");
    }

    let reason = problem.unwrap_or("the workspace root package.json gives none");

    Gathered {
        value: None,
        failures: vec![
            BundleFailure::new(
                BundleFailureCode::ContractMissing,
                format!(
                    "The contract has no {}: {reason}, and none was passed.",
                    missing.join(" and ")
                ),
                &format!(
                    "Add \"name\" and \"version\" to the package.json at the workspace root, or pass {}.",
                    missing_flags.join(" and ")
                ),
            )
            .about(PACKAGE_MANIFEST),
        ],
    }
}

struct GatheredFiles {
    files: IndexMap<String, Vec<u8>>,
    failures: Vec<BundleFailure>,
}

/// Where a loaded file lands in the bundle: its path, or why it cannot.
#[derive(Clone)]
enum Placement {
    Path(String),
    Refused(Box<BundleFailure>),
}

fn source_files(
    reader: &dyn LoadReader,
    recording: &RecordingReader<'_>,
    loaded: &[String],
) -> GatheredFiles {
    let mut files = IndexMap::new();
    let mut failures = Vec::new();
    let mut path_by_fold: HashMap<String, String> = HashMap::new();
    let mut pack_directories: HashMap<String, Placement> = HashMap::new();

    for source in loaded {
        // The load stage also lists files it looked for and did not find: the compilation
        // succeeded without them.
        let Some(text) = recording.text_of(source) else {
            continue;
        };

        let placed = match bundle_path_of(reader, source, &mut pack_directories) {
            Placement::Path(path) => path,
            Placement::Refused(failure) => {
                failures.push(*failure);

                continue;
            }
        };

        let problem =
            writable_path_problem(&placed).or_else(|| case_problem(&path_by_fold, &placed));

        if let Some(problem) = problem {
            failures.push(unportable_failure(source, &placed, &problem));

            continue;
        }

        path_by_fold.insert(bundle_path_fold(&placed), placed.clone());
        files.insert(placed, with_lf_line_ends(&text).into_bytes());
    }

    GatheredFiles {
        files,
        failures: dedupe_failures(failures),
    }
}

fn with_lf_line_ends(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn writable_path_problem(path: &str) -> Option<String> {
    if let Some(problem) = bundle_path_problem(path) {
        return Some(problem);
    }

    ustar_path_split(path).is_none().then(|| {
        "does not fit a tar header (a name of at most 100 characters after a directory of at most 155)"
            .to_owned()
    })
}

fn case_problem(path_by_fold: &HashMap<String, String>, path: &str) -> Option<String> {
    let same_fold = path_by_fold.get(&bundle_path_fold(path))?;

    Some(if same_fold == path {
        "is also the bundle file of another loaded file (one pack version installed in two places)"
            .to_owned()
    } else {
        format!("differs from '{same_fold}' only in letter case")
    })
}

fn has_drive_prefix(source: &str) -> bool {
    let mut characters = source.chars();

    characters
        .next()
        .is_some_and(|letter| letter.is_ascii_alphabetic())
        && characters.next() == Some(':')
}

fn bundle_path_of(
    reader: &dyn LoadReader,
    source: &str,
    pack_directories: &mut HashMap<String, Placement>,
) -> Placement {
    if let Some((package_directory, inside)) = split_pack_file(source) {
        let vendored = pack_directories
            .entry(package_directory.to_owned())
            .or_insert_with(|| vendored_directory(reader, package_directory))
            .clone();

        return match vendored {
            Placement::Path(directory) => Placement::Path(format!("{directory}/{inside}")),
            refused @ Placement::Refused(_) => refused,
        };
    }

    if source.starts_with("../") || source.starts_with('/') || has_drive_prefix(source) {
        return Placement::Refused(Box::new(
            BundleFailure::new(
                BundleFailureCode::FileOutsideRoot,
                format!(
                    "'{source}' is above the workspace root and in no pack, so the bundle cannot carry it."
                ),
                "Move the file under the workspace root, or install it as a pack package.",
            )
            .about(source),
        ));
    }

    Placement::Path(format!("{BUNDLE_SOURCES_DIRECTORY}/{source}"))
}

fn vendored_directory(reader: &dyn LoadReader, package_directory: &str) -> Placement {
    let name = package_name_of(package_directory).unwrap_or(package_directory);
    let manifest_file = format!("{package_directory}/{PACKAGE_MANIFEST}");
    let manifest = read_package_manifest(reader, &manifest_file);

    let version = match &manifest {
        PackageManifest::Members(members) => non_empty_string(members, "version"),
        PackageManifest::Absent | PackageManifest::Unreadable(_) => None,
    };

    if let Some(version) = version {
        return Placement::Path(format!(
            "{BUNDLE_SOURCES_DIRECTORY}/{}",
            pack_vendored_directory(name, &version)
        ));
    }

    let problem = match manifest {
        PackageManifest::Unreadable(problem) => problem,
        PackageManifest::Absent | PackageManifest::Members(_) => {
            format!("'{manifest_file}' holds no version string")
        }
    };

    Placement::Refused(Box::new(
        BundleFailure::new(
            BundleFailureCode::PackUnreadable,
            format!("The pack package '{name}' has no version the bundle can read: {problem}."),
            "Reinstall the pack package, so its package.json holds a version string.",
        )
        .about(&manifest_file),
    ))
}

fn unportable_failure(source: &str, path: &str, problem: &str) -> BundleFailure {
    BundleFailure::new(
        BundleFailureCode::PathUnportable,
        format!("'{source}' would be the bundle file '{path}', which {problem}."),
        "Rename the file (and its references) to letters, digits and . _ @ + -, so every reader lists it alike.",
    )
    .about(source)
}

/// One failure per code and file: the last of a kind, in the place of the first.
fn dedupe_failures(failures: Vec<BundleFailure>) -> Vec<BundleFailure> {
    let mut by_key: IndexMap<String, BundleFailure> = IndexMap::new();

    for failure in failures {
        let key = format!(
            "{} {}",
            failure.code.as_str(),
            failure.file.as_deref().unwrap_or("")
        );

        by_key.insert(key, failure);
    }

    by_key.into_values().collect()
}

struct GatheredIrs {
    files: IndexMap<String, Vec<u8>>,
    failures: Vec<BundleFailure>,
    apis: Vec<BundleApi>,
    packs: Vec<BundleNamedVersion>,
}

fn ir_files(compiled: &PipelineResult) -> Result<GatheredIrs, BundleError> {
    let mut files = IndexMap::new();
    let mut failures = Vec::new();
    let mut apis = Vec::new();
    let mut packs: IndexMap<String, BundleNamedVersion> = IndexMap::new();

    for api in &compiled.apis {
        let Some(ir) = &api.ir else {
            return Err(InternalError::new(format!(
                "bundle: api '{}' compiled with no error and no IR.",
                api.api
            ))
            .into());
        };

        let file = format!("{BUNDLE_IR_DIRECTORY}/{}.json", api.api);

        if let Some(problem) = writable_path_problem(&file) {
            failures.push(unportable_failure(
                &format!("api {}", api.api),
                &file,
                &problem,
            ));

            continue;
        }

        files.insert(file.clone(), finalize_serialize_ir(ir)?.into_bytes());
        apis.push(BundleApi {
            name: api.api.clone(),
            file,
            ir_version: ir.ir_version,
            ir_revision: ir.ir_revision,
        });

        for pack in &ir.packs {
            packs.insert(
                format!("{}@{}", pack.name, pack.version),
                BundleNamedVersion {
                    name: pack.name.clone(),
                    version: pack.version.clone(),
                },
            );
        }
    }

    let mut sorted_packs: Vec<BundleNamedVersion> = packs.into_values().collect();

    sorted_packs.sort_by(|left, right| {
        compare_bundle_paths(&left.name, &right.name)
            .then_with(|| compare_bundle_paths(&left.version, &right.version))
    });
    apis.sort_by(|left, right| compare_bundle_paths(&left.name, &right.name));

    Ok(GatheredIrs {
        files,
        failures,
        apis,
        packs: sorted_packs,
    })
}
