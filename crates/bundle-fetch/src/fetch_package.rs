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

#[cfg(test)]
mod tests {
    use super::*;

    fn installed(manifest: Option<&str>, version: &str) -> InstalledPackage {
        let project = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(project.path()).unwrap();

        if let Some(manifest) = manifest {
            let package = root.join("node_modules/@scope/notes");

            fs::create_dir_all(&package).unwrap();
            fs::write(package.join(PACKAGE_MANIFEST), manifest).unwrap();
        }

        let source = PackageBundleSource {
            package: "@scope/notes".to_owned(),
            version: version.to_owned(),
        };
        let result = installed_bundle_package(&source, root).unwrap();

        // The project path is a temporary one: make the failure text stable.
        match result {
            InstalledPackage::Failed(mut failure) => {
                failure.message = failure.message.replace(root.as_str(), "<root>");
                failure.file = failure
                    .file
                    .map(|file| file.replace(root.as_str(), "<root>"));

                InstalledPackage::Failed(failure)
            }
            InstalledPackage::Directory(directory) => InstalledPackage::Directory(directory),
        }
    }

    fn failure_of(result: InstalledPackage) -> BundleSourceFailure {
        match result {
            InstalledPackage::Failed(failure) => failure,
            InstalledPackage::Directory(directory) => panic!("expected a failure, got {directory}"),
        }
    }

    #[test]
    fn a_package_that_is_not_installed_is_named() {
        let failure = failure_of(installed(None, "1.0.0"));

        assert_eq!(failure.code, BundleSourceFailureCode::PackageMissing);
        assert_eq!(
            failure.message,
            "The bundle package '@scope/notes' is not installed in the project of <root>."
        );
        assert_eq!(
            failure.fix,
            "Install it with your package manager, at version 1.0.0."
        );
    }

    #[test]
    fn a_package_at_another_version_names_both_versions() {
        let failure = failure_of(installed(Some(r#"{"version":"2.0.0"}"#), "1.0.0"));

        assert_eq!(failure.code, BundleSourceFailureCode::PackageVersion);
        assert_eq!(
            failure.message,
            "The installed bundle package '@scope/notes' is at version '2.0.0'; the source names 1.0.0."
        );
        assert_eq!(failure.expected.as_deref(), Some("1.0.0"));
        assert_eq!(failure.actual.as_deref(), Some("2.0.0"));
        assert!(
            failure
                .file
                .as_deref()
                .is_some_and(|file| file.ends_with("node_modules/@scope/notes/package.json"))
        );
    }

    #[test]
    fn a_manifest_without_a_usable_version_reads_as_none() {
        for manifest in [
            "{}",
            r#"{"version":3}"#,
            "[]",
            "not json",
            "\u{feff}{\"version\":\"1.0.0\"}",
        ] {
            let failure = failure_of(installed(Some(manifest), "1.0.0"));

            assert!(
                failure.message.contains("is at version (none);"),
                "manifest {manifest:?}: {}",
                failure.message
            );
            assert_eq!(failure.actual, None, "manifest {manifest:?}");
        }
    }

    #[test]
    fn a_package_at_the_named_version_is_the_bundle_directory() {
        assert!(matches!(
            installed(Some(r#"{"version":"1.0.0"}"#), "1.0.0"),
            InstalledPackage::Directory(directory) if directory.ends_with("node_modules/@scope/notes")
        ));
    }
}
