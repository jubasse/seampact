//! The extraction of a bundle tarball into a private temporary directory.

#![cfg(unix)]
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt as _;

use seampact_bundle::{BundleArchiveExtraction, extract_bundle_tarball};
use serde_json::Value;
use support::{base64_decoded, repository_root};

fn first_readable_archive() -> Vec<u8> {
    let path = repository_root().join("packages/core/spec/vectors/bundle/vectors.json");
    let vectors: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let archive = vectors["archives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|archive| archive["expected"]["ok"] == Value::Bool(true))
        .unwrap();
    let text = archive["base64"].as_str().unwrap();

    base64_decoded(text)
}

#[test]
fn the_extracted_directory_is_private_and_removed_with_its_guard() {
    let tarball = first_readable_archive();
    let BundleArchiveExtraction::Extracted(extracted) = extract_bundle_tarball(&tarball).unwrap()
    else {
        panic!("the archive was refused");
    };
    let directory = extracted.path().to_owned();
    let mode = fs::metadata(&directory).unwrap().permissions().mode() & 0o777;

    assert_eq!(mode, 0o700, "mode of {directory}");

    drop(extracted);

    assert!(!directory.exists(), "{directory} is removed with the guard");
}
