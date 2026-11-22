//! The npm channel on Node: the package installed in the project, at the version the source names.
//!
//! The package is found as Node finds one, in the `node_modules` of the base directory or of a
//! directory above it; the bundle is the package root (its own `package.json`, `README*`,
//! `LICENSE*` and `CHANGELOG*` allowed by the check).

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle::{
    PackageBundleSource, UntrustedJson, installed_package_directory, parse_untrusted_json,
};
use seampact_diagnostics::quote_text;
use seampact_json::JsonValue;

use crate::{BundleFetchError, BundleSourceFailure, BundleSourceFailureCode};

const PACKAGE_MANIFEST: &str = "package.json";

/// The installed package's real directory, or the failure naming what is missing or which version
/// is installed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum InstalledPackage {
    /// The package at the version the source names.
    Directory(Utf8PathBuf),
    /// Why the package cannot be read as the bundle.
    Failed(BundleSourceFailure),
}

/// Finds the package `source` names from `base_directory` and checks its installed version.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when the lookup or the manifest read fails.
pub(crate) fn installed_bundle_package(
    source: &PackageBundleSource,
    base_directory: &Utf8Path,
) -> Result<InstalledPackage, BundleFetchError> {
    let Some(directory) = installed_package_directory(&source.package, base_directory)? else {
        return Ok(InstalledPackage::Failed(BundleSourceFailure::new(
            BundleSourceFailureCode::PackageMissing,
            format!(
                "The bundle package '{}' is not installed in the project of {base_directory}.",
                source.package
            ),
            &format!(
                "Install it with your package manager, at version {}.",
                source.version
            ),
        )));
    };
    let version = installed_version(&directory)?;

    if version.as_deref() == Some(source.version.as_str()) {
        return Ok(InstalledPackage::Directory(directory));
    }

    let installed = version
        .as_deref()
        .map_or_else(|| "(none)".to_owned(), quote_text);
    let failure = BundleSourceFailure::new(
        BundleSourceFailureCode::PackageVersion,
        format!(
            "The installed bundle package '{}' is at version {installed}; the source names {}.",
            source.package, source.version
        ),
        &format!(
            "Install version {}, or name the installed version in the source and pin its integrity.",
            source.version
        ),
    )
    .about(directory.join(PACKAGE_MANIFEST).as_str())
    .expecting(source.version.clone());

    Ok(InstalledPackage::Failed(match version {
        Some(actual) => failure.finding(actual),
        None => failure,
    }))
}

fn installed_version(directory: &Utf8Path) -> Result<Option<String>, BundleFetchError> {
    let manifest = directory.join(PACKAGE_MANIFEST);
    let bytes = fs::read(&manifest).map_err(|error| BundleFetchError::io(&manifest, &error))?;
    let UntrustedJson::Parsed(JsonValue::Object(members)) =
        parse_untrusted_json(&String::from_utf8_lossy(&bytes))
    else {
        return Ok(None);
    };

    Ok(match members.get("version") {
        Some(JsonValue::String(version)) => Some(version.clone()),
        _ => None,
    })
}
