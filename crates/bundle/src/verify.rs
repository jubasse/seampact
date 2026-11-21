//! The check of a bundle on disk against its manifest and a pinned integrity.

use std::fs;

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;

use crate::bundle_file_check::{FilesCheck, check_files};
use crate::bundle_ir_check::{BundleIrRead, check_bundle_ir};
use crate::bundle_walk::{BundleWalk, walk_bundle};
use crate::limits::BUNDLE_MANIFEST_BYTES_MAX;
use crate::pin_check::check_integrity;
use crate::{
    BUNDLE_MANIFEST_FILE, BundleError, BundleFailure, BundleFailureCode, BundleManifest,
    BundleManifestRead, bundle_integrity, manifest_too_large, read_bundle_manifest,
};

/// The channel a bundle was fetched through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum BundleChannel {
    /// `package`.
    Package,
    /// `release`.
    Release,
    /// `git`.
    Git,
}

/// A verified bundle, or the failures that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleVerifyResult {
    /// The bundle passed.
    Verified {
        /// The `manifest` member.
        manifest: BundleManifest,
        /// The `integrity` member.
        integrity: String,
        /// Each api's IR by api name.
        irs: IndexMap<String, ContractIr>,
    },
    /// Why the bundle is refused.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleFailure>,
        /// The recomputed integrity, once the files passed: the value to pin.
        integrity: Option<String>,
    },
}

/// Verifies the bundle in `directory` in order: every listed file, the integrity and the pin, then
/// each api's IR. A step runs only when the steps before it pass.
///
/// # Errors
///
/// [`BundleError::Io`] when the directory cannot be read, [`BundleError::Internal`] for a bug.
pub fn verify_bundle(
    directory: &Utf8Path,
    pinned_integrity: Option<&str>,
    channel: Option<BundleChannel>,
) -> Result<BundleVerifyResult, BundleError> {
    let walked = match walk_bundle(directory)? {
        BundleWalk::Sizes(sizes) => sizes,
        BundleWalk::Refused(failure) => return Ok(failed(vec![failure], None)),
    };
    let Some(manifest_size) = walked.get(BUNDLE_MANIFEST_FILE).copied() else {
        return Ok(failed(
            vec![
                BundleFailure::new(
                    BundleFailureCode::ManifestMissing,
                    format!("The bundle has no '{BUNDLE_MANIFEST_FILE}' at its root."),
                    "Check that the source names a seampact bundle (`seampact bundle` writes the manifest).",
                )
                .about(BUNDLE_MANIFEST_FILE),
            ],
            None,
        ));
    };

    if usize::try_from(manifest_size).map_or(true, |size| size > BUNDLE_MANIFEST_BYTES_MAX) {
        let size = usize::try_from(manifest_size).unwrap_or(usize::MAX);

        return Ok(failed(vec![manifest_too_large(size)], None));
    }

    let manifest_path = directory.join(BUNDLE_MANIFEST_FILE);
    let manifest_bytes = fs::read(&manifest_path).map_err(|error| BundleError::Io {
        path: manifest_path.to_string(),
        message: error.to_string(),
    })?;
    let manifest = match read_bundle_manifest(&manifest_bytes)? {
        BundleManifestRead::Manifest(manifest) => manifest,
        BundleManifestRead::Refused(failure) => return Ok(failed(vec![failure], None)),
    };
    let files = match check_files(directory, &manifest, &walked, channel)? {
        FilesCheck::Bytes(files) => files,
        FilesCheck::Failed(failures) => return Ok(failed(failures, None)),
    };
    let integrity = bundle_integrity(&manifest.files);

    if let Some(failure) = check_integrity(&manifest, &integrity, pinned_integrity) {
        return Ok(failed(vec![failure], Some(integrity)));
    }

    let mut irs = IndexMap::new();
    let mut ir_failures = Vec::new();

    for api in &manifest.apis {
        // The manifest rules list every api's file, and the file step read every listed file.
        let bytes = files.get(&api.file).ok_or_else(|| {
            InternalError::new(format!(
                "bundle: the checked file '{}' of api '{}' was not read.",
                api.file, api.name
            ))
        })?;

        match check_bundle_ir(api, bytes)? {
            BundleIrRead::Ir(ir) => {
                irs.insert(api.name.clone(), *ir);
            }
            BundleIrRead::Refused(failure) => ir_failures.push(failure),
        }
    }

    if !ir_failures.is_empty() {
        return Ok(failed(ir_failures, Some(integrity)));
    }

    Ok(BundleVerifyResult::Verified {
        manifest,
        integrity,
        irs,
    })
}

fn failed(failures: Vec<BundleFailure>, integrity: Option<String>) -> BundleVerifyResult {
    BundleVerifyResult::Failed {
        failures,
        integrity,
    }
}
