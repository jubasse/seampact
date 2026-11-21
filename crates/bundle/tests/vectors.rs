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
    BundleArchiveRead, BundleFile, bundle_integrity, bundle_sha256_hex, read_bundle_tarball,
};
use serde_json::Value;
use support::repository_root;

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
