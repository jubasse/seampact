//! `seampact bundle`'s library half: a bundle written as a directory, an npm package or a tarball.

use std::fs;
use std::io::Write as _;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_compiler::PipelineResult;
use seampact_json::{JsonObject, JsonValue, indented_json};
use seampact_paths::{ParseOutputPathError, RelativeOutputPath};

use crate::contents::bundle_entries;
use crate::tarball_write::bundle_tarball;
use crate::{
    BundleBuildOptions, BundleBuildResult, BundleError, BundleFailure, BundleFailureCode,
    BundleManifest, build_bundle,
};

const NPM_PACKAGE_MANIFEST: &str = "package.json";
const BUNDLE_PACKAGE_ROLE: &str = "bundle";

/// Where a bundle is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleOutput {
    /// A new or empty directory.
    Directory(Utf8PathBuf),
    /// A new or empty directory that also holds npm's `package.json`, ready for `npm publish`.
    NpmPackage(Utf8PathBuf),
    /// The tarball file to write; its directory is created.
    Tarball(Utf8PathBuf),
}

/// What to bundle and where to write it.
#[derive(Debug)]
pub struct BundleWriteOptions<'run> {
    /// What the bundle is built from.
    pub build: BundleBuildOptions<'run>,
    /// Where it is written.
    pub output: BundleOutput,
}

/// The manifest written, or the failures that wrote nothing.
#[derive(Debug, Clone)]
pub enum BundleWriteResult {
    /// The bundle is written.
    Written {
        /// The `manifest` member.
        manifest: Box<BundleManifest>,
        /// The `compiled` member.
        compiled: Box<PipelineResult>,
    },
    /// Why nothing is written.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleFailure>,
        /// The compilation, when it failed.
        compiled: Option<Box<PipelineResult>>,
    },
}

fn unsafe_entry_error(target: &Utf8Path, error: &ParseOutputPathError) -> BundleError {
    BundleError::Io {
        path: target.to_string(),
        message: error.to_string(),
    }
}

fn io_error(path: &Utf8Path, error: &std::io::Error) -> BundleError {
    BundleError::Io {
        path: path.to_string(),
        message: error.to_string(),
    }
}

/// Bundles the workspace and writes it; nothing is written when the bundle cannot be made.
///
/// # Errors
///
/// [`BundleError::Io`] when a file or directory cannot be written, [`BundleError::Internal`] for
/// a bug.
pub fn write_bundle(options: &BundleWriteOptions<'_>) -> Result<BundleWriteResult, BundleError> {
    let directory = match &options.output {
        BundleOutput::Directory(directory) | BundleOutput::NpmPackage(directory) => Some(directory),
        BundleOutput::Tarball(_) => None,
    };

    if let Some(target) = directory.filter(|target| !is_new_or_empty(target)) {
        return Ok(BundleWriteResult::Failed {
            failures: vec![output_not_empty(target)],
            compiled: None,
        });
    }

    let (contents, compiled) = match build_bundle(&options.build)? {
        BundleBuildResult::Built { contents, compiled } => (contents, compiled),
        BundleBuildResult::Failed { failures, compiled } => {
            return Ok(BundleWriteResult::Failed { failures, compiled });
        }
    };

    match &options.output {
        BundleOutput::Tarball(tarball) => {
            if let Some(parent) = tarball.parent() {
                fs::create_dir_all(parent).map_err(|error| io_error(parent, &error))?;
            }

            fs::write(tarball, bundle_tarball(&contents)?)
                .map_err(|error| io_error(tarball, &error))?;
        }
        BundleOutput::Directory(target) | BundleOutput::NpmPackage(target) => {
            for entry in bundle_entries(&contents) {
                let relative = RelativeOutputPath::try_new(entry.path.as_str())
                    .map_err(|error| unsafe_entry_error(target, &error))?;

                write_new_file(&target.join(relative.as_path()), &entry.bytes)?;
            }

            if matches!(options.output, BundleOutput::NpmPackage(_)) {
                write_new_file(
                    &target.join(NPM_PACKAGE_MANIFEST),
                    npm_package_manifest(&contents.manifest).as_bytes(),
                )?;
            }
        }
    }

    Ok(BundleWriteResult::Written {
        manifest: Box::new(contents.manifest),
        compiled,
    })
}

fn output_not_empty(target: &Utf8Path) -> BundleFailure {
    BundleFailure::new(
        BundleFailureCode::OutputNotEmpty,
        format!(
            "The output directory '{target}' is not empty; a bundle directory holds the bundle's files only."
        ),
        "Name a new or empty directory, or remove this one first.",
    )
    .about(target.as_str())
}

/// Writes a file that must not exist yet, creating its directory.
fn write_new_file(file: &Utf8Path, bytes: &[u8]) -> Result<(), BundleError> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error(parent, &error))?;
    }

    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)
        .and_then(|mut opened| opened.write_all(bytes))
        .map_err(|error| io_error(file, &error))
}

fn npm_package_manifest(manifest: &BundleManifest) -> String {
    let mut seampact = JsonObject::new();
    let mut package = JsonObject::new();

    seampact.insert(
        "role".to_owned(),
        JsonValue::String(BUNDLE_PACKAGE_ROLE.to_owned()),
    );
    package.insert(
        "name".to_owned(),
        JsonValue::String(manifest.contract.name.clone()),
    );
    package.insert(
        "version".to_owned(),
        JsonValue::String(manifest.contract.version.clone()),
    );
    package.insert("seampact".to_owned(), JsonValue::Object(seampact));

    indented_json(&JsonValue::Object(package))
}

/// Whether `directory` does not exist or lists nothing. A directory that cannot be listed counts
/// as not empty, so nothing is written into it.
fn is_new_or_empty(directory: &Utf8Path) -> bool {
    if !directory.exists() {
        return true;
    }

    directory
        .read_dir_utf8()
        .is_ok_and(|mut entries| entries.next().is_none())
}
