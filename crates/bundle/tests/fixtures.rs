//! The bundle cases of `fixtures/bundle`: the build compared with the recorded expected files.

#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use std::fs;

use camino::Utf8Path;
use seampact_bundle::{
    BundleBuildOptions, BundleBuildResult, BundleFailure, BundleNamedVersionOverride, build_bundle,
    bundle_manifest_bytes, bundle_tarball,
};
use seampact_load::FsReader;
use seampact_oracle::{gunzipped_ustar_entries, manifest_mismatches};
use serde_json::{Value, json};
use support::repository_root;

/// A failure as `refusals.json` writes it.
fn failure_json(failure: &BundleFailure) -> Value {
    let mut members = json!({
        "code": failure.code.as_str(),
        "message": failure.message,
        "fix": failure.fix,
    });

    for (key, value) in [
        ("file", &failure.file),
        ("expected", &failure.expected),
        ("actual", &failure.actual),
    ] {
        if let (Some(text), Some(object)) = (value, members.as_object_mut()) {
            object.insert(key.to_owned(), Value::String(text.clone()));
        }
    }

    members
}

fn json_of(path: &Utf8Path) -> Value {
    let text = fs::read_to_string(path).unwrap();

    serde_json::from_str(&text).unwrap()
}

fn case_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(repository_root().join("fixtures/bundle"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();

    names.sort();

    names
}

#[test]
fn every_bundle_case_builds_what_the_expected_files_record() {
    let root = repository_root();

    for name in case_names() {
        let directory = root.join("fixtures/bundle").join(&name);
        let expected = root
            .join("fixtures/expected/bundle")
            .join(&name)
            .join("bundle");
        let spec = json_of(&directory.join("bundle.json"));
        let workspace = directory.join(spec["workspace"].as_str().unwrap_or("workspace.yaml"));
        let workspace = Utf8Path::from_path(&workspace.as_std_path().canonicalize().unwrap())
            .unwrap()
            .to_owned();
        let reader = FsReader::new(workspace.parent().unwrap()).unwrap();
        let built = build_bundle(&BundleBuildOptions {
            reader: &reader,
            entry: workspace.file_name().unwrap(),
            contract: Some(BundleNamedVersionOverride {
                name: spec["name"].as_str().map(str::to_owned),
                version: spec["version"].as_str().map(str::to_owned),
            }),
        })
        .unwrap();

        match built {
            BundleBuildResult::Failed { failures, .. } => {
                let actual: Vec<Value> = failures.iter().map(failure_json).collect();

                assert_eq!(
                    Value::Array(actual),
                    json_of(&expected.join("refusals.json")),
                    "case {name}"
                );
            }
            BundleBuildResult::Built { contents, .. } => {
                let manifest =
                    String::from_utf8(bundle_manifest_bytes(&contents.manifest)).unwrap();
                let expected_manifest = fs::read_to_string(expected.join("manifest.json")).unwrap();

                assert_eq!(
                    manifest_mismatches(&expected_manifest, &manifest).unwrap(),
                    vec![],
                    "case {name}: manifest"
                );
                assert_eq!(
                    format!("{}\n", contents.manifest.integrity),
                    fs::read_to_string(expected.join("integrity.txt")).unwrap(),
                    "case {name}: integrity"
                );

                let listed: Vec<Value> = contents
                    .manifest
                    .files
                    .iter()
                    .map(|file| {
                        serde_json::json!({"path": file.path, "size": file.size, "sha256": file.sha256})
                    })
                    .collect();

                assert_eq!(
                    Value::Array(listed),
                    json_of(&expected.join("files.json")),
                    "case {name}: files"
                );
                assert_eq!(
                    gunzipped_ustar_entries(&bundle_tarball(&contents).unwrap()).unwrap(),
                    json_of(&expected.join("ustar.json")),
                    "case {name}: ustar"
                );
            }
        }
    }
}
