//! The first step of the bundle check: every listed file exists with its size and SHA-256, and no
//! file is unlisted.

use std::collections::{HashMap, HashSet};
use std::fs;

use camino::Utf8Path;
use seampact_diagnostics::quote_text;
use seampact_js::cmp_utf16;

use crate::refetch::REFETCH_FIX;
use crate::{
    BUNDLE_MANIFEST_FILE, BundleChannel, BundleError, BundleFailure, BundleFailureCode,
    BundleManifest, bundle_sha256_hex,
};

/// Files npm adds to or keeps in every package, at the package root (npm's `files` rules).
const NPM_PACKAGE_MANIFEST: &str = "package.json";
const NPM_ALWAYS_INCLUDED: [&str; 4] = ["readme", "license", "licence", "changelog"];

/// The bytes of every listed file by path, or every failure found.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum FilesCheck {
    /// Each file passed.
    Bytes(HashMap<String, Vec<u8>>),
    /// The failures, listed files first then the unlisted ones in UTF-16 order.
    Failed(Vec<BundleFailure>),
}

/// Checks the files of `manifest` against the sizes `walked` and the bytes in `directory`.
pub(crate) fn check_files(
    directory: &Utf8Path,
    manifest: &BundleManifest,
    walked: &HashMap<String, u64>,
    channel: Option<BundleChannel>,
) -> Result<FilesCheck, BundleError> {
    let mut failures = Vec::new();
    let mut bytes_by_path = HashMap::new();

    for file in &manifest.files {
        let Some(size) = walked.get(&file.path).copied() else {
            failures.push(
                BundleFailure::new(
                    BundleFailureCode::FileMissing,
                    format!(
                        "'{}' is listed in the manifest and missing from the bundle.",
                        file.path
                    ),
                    REFETCH_FIX,
                )
                .about(&file.path),
            );

            continue;
        };

        if size != file.size {
            failures.push(
                BundleFailure::new(
                    BundleFailureCode::FileSize,
                    format!(
                        "'{}' holds {size} bytes; the manifest lists {}.",
                        file.path, file.size
                    ),
                    REFETCH_FIX,
                )
                .about(&file.path)
                .expecting(file.size.to_string())
                .finding(size.to_string()),
            );

            continue;
        }

        let location = directory.join(&file.path);
        let bytes = fs::read(&location).map_err(|error| BundleError::Io {
            path: location.to_string(),
            message: error.to_string(),
        })?;
        let sha256 = bundle_sha256_hex(&bytes);

        if sha256 != file.sha256 {
            failures.push(
                BundleFailure::new(
                    BundleFailureCode::FileHash,
                    format!(
                        "'{}' has the SHA-256 {sha256}; the manifest lists {}.",
                        file.path, file.sha256
                    ),
                    REFETCH_FIX,
                )
                .about(&file.path)
                .expecting(file.sha256.clone())
                .finding(sha256),
            );

            continue;
        }

        bytes_by_path.insert(file.path.clone(), bytes);
    }

    let listed: HashSet<&str> = manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let mut unlisted: Vec<&String> = walked
        .keys()
        .filter(|path| {
            path.as_str() != BUNDLE_MANIFEST_FILE
                && !listed.contains(path.as_str())
                && !is_npm_file(path, channel)
        })
        .collect();

    unlisted.sort_by(|left, right| cmp_utf16(left, right));

    for path in unlisted {
        failures.push(
            BundleFailure::new(
                BundleFailureCode::FileUnlisted,
                format!(
                    "{} is in the bundle and not listed in the manifest.",
                    quote_text(path)
                ),
                REFETCH_FIX,
            )
            .about(path),
        );
    }

    if failures.is_empty() {
        return Ok(FilesCheck::Bytes(bytes_by_path));
    }

    Ok(FilesCheck::Failed(failures))
}

/// Whether `path` is a file npm keeps at the root of a package: `package.json`, or `README`,
/// `LICENSE`, `LICENCE` or `CHANGELOG` alone or followed by `.` or `-` and anything on one line.
fn is_npm_file(path: &str, channel: Option<BundleChannel>) -> bool {
    if channel != Some(BundleChannel::Package) || path.contains('/') {
        return false;
    }

    path == NPM_PACKAGE_MANIFEST
        || NPM_ALWAYS_INCLUDED
            .iter()
            .any(|name| names_file(path, name))
}

/// The pattern `^name(?:[.-].*)?$` with the `i` and `u` flags: `.` stops at a line terminator.
fn names_file(path: &str, name: &str) -> bool {
    let mut characters = path.chars();

    for expected in name.chars() {
        match characters.next() {
            Some(found) if folds_to(found, expected) => {}
            _ => return false,
        }
    }

    let rest = characters.as_str();

    rest.is_empty()
        || rest
            .strip_prefix(['.', '-'])
            .is_some_and(|tail| !tail.contains(['\n', '\r', '\u{2028}', '\u{2029}']))
}

/// Simple case folding of the `iu` flags: the long s (U+017F) folds to `s`.
fn folds_to(found: char, expected: char) -> bool {
    let folded = if found == '\u{17f}' {
        's'
    } else {
        found.to_ascii_lowercase()
    };

    folded == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_files_follow_the_case_insensitive_pattern() {
        let cases = [
            ("package.json", true),
            ("README", true),
            ("ReadMe.md", true),
            ("LICENSE-MIT", true),
            ("licence", true),
            ("LICen\u{17f}e", true),
            ("changelog.", true),
            ("READMEx", false),
            ("readme.\nmd", false),
            ("readme-a\u{2028}b", false),
            ("docs/readme", false),
            ("Package.json", false),
            ("", false),
        ];

        for (path, expected) in cases {
            assert_eq!(
                is_npm_file(path, Some(BundleChannel::Package)),
                expected,
                "path {path:?}"
            );
        }
    }

    #[test]
    fn other_channels_keep_no_npm_file() {
        assert!(!is_npm_file("package.json", Some(BundleChannel::Release)));
        assert!(!is_npm_file("package.json", None));
    }
}
