//! The steps of the bundle check that stop before any IR is read.

#![allow(
    clippy::unwrap_used,
    clippy::panic,
    reason = "test code: a failed setup is the failed test"
)]

mod support;

use std::fs;

use camino::Utf8PathBuf;
use seampact_bundle::{BUNDLE_MANIFEST_FILE, BundleFailureCode, BundleVerifyResult, verify_bundle};
use support::scratch_directory;

fn failure_codes(directory: &Utf8PathBuf) -> Vec<BundleFailureCode> {
    match verify_bundle(directory, None, None).unwrap() {
        BundleVerifyResult::Failed { failures, .. } => {
            failures.iter().map(|failure| failure.code).collect()
        }
        BundleVerifyResult::Verified { .. } => panic!("the bundle verified"),
    }
}

#[test]
fn a_directory_without_manifest_is_refused() {
    let directory = scratch_directory("verify-no-manifest");

    fs::write(directory.join("note.txt"), "x").unwrap();

    assert_eq!(
        failure_codes(&directory),
        [BundleFailureCode::ManifestMissing]
    );
}

#[test]
fn a_manifest_that_is_not_json_is_refused() {
    let directory = scratch_directory("verify-bad-manifest");

    fs::write(directory.join(BUNDLE_MANIFEST_FILE), "{").unwrap();

    assert_eq!(
        failure_codes(&directory),
        [BundleFailureCode::ManifestInvalid]
    );
}

#[cfg(unix)]
#[test]
fn a_link_is_refused_before_the_manifest_is_read() {
    let directory = scratch_directory("verify-link");

    fs::write(directory.join("target.txt"), "x").unwrap();
    std::os::unix::fs::symlink("target.txt", directory.join("link.txt")).unwrap();

    assert_eq!(failure_codes(&directory), [BundleFailureCode::FileType]);
}
