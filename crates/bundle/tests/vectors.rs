//! The bundle vectors: archives read as every verifier must, and the integrity of valid bundles.

#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use std::fs;

use seampact_bundle::{
    BundleArchiveRead, BundleChannel, BundleFile, BundleVerifyResult, bundle_integrity,
    bundle_sha256_hex, read_bundle_tarball, verify_bundle,
};
use serde_json::Value;
use support::{repository_root, scratch_directory};

fn vectors() -> Value {
    let path = repository_root().join("packages/core/spec/vectors/bundle/vectors.json");

    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn base64_decoded(text: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut group = 0_u32;
    let mut count = 0;

    for character in text.chars().filter(|c| *c != '=') {
        let sextet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            .find(character)
            .unwrap();

        group = group << 6 | u32::try_from(sextet).unwrap();
        count += 1;

        if count == 4 {
            bytes.extend_from_slice(&group.to_be_bytes()[1..]);
            group = 0;
            count = 0;
        }
    }

    match count {
        2 => bytes.push(u8::try_from((group >> 4) & 0xff).unwrap()),
        3 => bytes.extend_from_slice(&[
            u8::try_from((group >> 10) & 0xff).unwrap(),
            u8::try_from((group >> 2) & 0xff).unwrap(),
        ]),
        _ => {}
    }

    bytes
}

#[test]
fn every_archive_vector_reads_to_its_paths_or_its_failure_codes() {
    let vectors = vectors();

    for vector in vectors["archives"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let expected = &vector["expected"];
        let tarball = base64_decoded(vector["base64"].as_str().unwrap());
        let (paths, codes): (Vec<String>, Vec<String>) = match read_bundle_tarball(&tarball) {
            BundleArchiveRead::Entries(entries) => (
                entries.into_iter().map(|entry| entry.path).collect(),
                vec![],
            ),
            BundleArchiveRead::Refused(failures) => (
                vec![],
                failures
                    .iter()
                    .map(|failure| failure.code.as_str().to_owned())
                    .collect(),
            ),
        };
        let expected_texts = |key: &str, member: Option<&str>| -> Vec<String> {
            expected[key]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| match member {
                    Some(name) => item[name].as_str().unwrap().to_owned(),
                    None => item.as_str().unwrap().to_owned(),
                })
                .collect()
        };

        assert_eq!(paths, expected_texts("paths", None), "vector {id}: paths");
        assert_eq!(
            codes,
            expected_texts("failures", Some("code")),
            "vector {id}: codes"
        );
    }
}

#[test]
fn the_integrity_of_every_valid_directory_vector_is_the_expected_one() {
    let vectors = vectors();

    for vector in vectors["directories"].as_array().unwrap() {
        if vector["expected"]["ok"] != Value::Bool(true) {
            continue;
        }

        let listed: Vec<BundleFile> = vector["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|file| {
                let path = file["path"].as_str().unwrap();

                (path.starts_with("sources/") || path.starts_with("ir/")).then(|| BundleFile {
                    path: path.to_owned(),
                    size: 0,
                    sha256: bundle_sha256_hex(&base64_decoded(file["base64"].as_str().unwrap())),
                })
            })
            .collect();

        assert_eq!(
            bundle_integrity(&listed),
            vector["expected"]["integrity"].as_str().unwrap(),
            "vector {}",
            vector["id"]
        );
    }
}

fn optional_text(member: &Value) -> Option<String> {
    member.as_str().map(str::to_owned)
}

/// The failures of a vector as `(code, file, expected, actual)`, `None` for an absent member.
type FailureTexts = Vec<(String, Option<String>, Option<String>, Option<String>)>;

fn expected_failures(expected: &Value) -> FailureTexts {
    expected["failures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|failure| {
            (
                failure["code"].as_str().unwrap().to_owned(),
                optional_text(&failure["file"]),
                optional_text(&failure["expected"]),
                optional_text(&failure["actual"]),
            )
        })
        .collect()
}

#[test]
fn every_directory_vector_verifies_as_expected() {
    let vectors = vectors();
    let directories = vectors["directories"].as_array().unwrap();

    assert_eq!(directories.len(), 33, "the directory vectors are 33");

    for vector in directories {
        let id = vector["id"].as_str().unwrap();
        let directory = scratch_directory(&format!("vector-{id}"));

        for file in vector["files"].as_array().unwrap() {
            let target = directory.join(file["path"].as_str().unwrap());

            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, base64_decoded(file["base64"].as_str().unwrap())).unwrap();
        }

        let channel = match vector["channel"].as_str() {
            Some("package") => Some(BundleChannel::Package),
            Some("release") => Some(BundleChannel::Release),
            other => panic!("vector {id}: channel {other:?}"),
        };
        let result = verify_bundle(&directory, vector["pin"].as_str(), channel).unwrap();
        let (ok, integrity, failures): (bool, Option<String>, FailureTexts) = match result {
            BundleVerifyResult::Verified { integrity, .. } => (true, Some(integrity), vec![]),
            BundleVerifyResult::Failed {
                failures,
                integrity,
            } => (
                false,
                integrity,
                failures
                    .into_iter()
                    .map(|failure| {
                        (
                            failure.code.as_str().to_owned(),
                            failure.file,
                            failure.expected,
                            failure.actual,
                        )
                    })
                    .collect(),
            ),
        };
        let expected = &vector["expected"];

        assert_eq!(ok, expected["ok"].as_bool().unwrap(), "vector {id}: ok");
        assert_eq!(
            integrity,
            optional_text(&expected["integrity"]),
            "vector {id}: integrity"
        );
        assert_eq!(
            failures,
            expected_failures(expected),
            "vector {id}: failures"
        );

        fs::remove_dir_all(&directory).unwrap();
    }
}
