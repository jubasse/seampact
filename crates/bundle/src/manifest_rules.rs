//! The manifest rules no JSON Schema states, checked after the schema.

use std::collections::{HashMap, HashSet};

use crate::file_list::compare_bundle_paths;
use crate::path::bundle_path_fold;
use crate::{BUNDLE_IR_DIRECTORY, BundleManifest};

/// A rule a schema-valid manifest breaks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleManifestProblem {
    /// A JSON Pointer into the manifest.
    pub pointer: String,
    /// What is wrong.
    pub message: String,
}

fn problem(pointer: String, message: String) -> BundleManifestProblem {
    BundleManifestProblem { pointer, message }
}

/// Every rule a schema-valid manifest breaks, in manifest order.
#[must_use]
pub fn bundle_manifest_rule_problems(manifest: &BundleManifest) -> Vec<BundleManifestProblem> {
    let mut problems = file_problems(manifest);

    problems.extend(api_problems(manifest));
    problems.extend(pack_problems(manifest));

    problems
}

fn file_problems(manifest: &BundleManifest) -> Vec<BundleManifestProblem> {
    let mut problems = Vec::new();
    let mut path_by_fold: HashMap<String, &str> = HashMap::new();
    let mut previous: Option<&str> = None;

    for (index, file) in manifest.files.iter().enumerate() {
        let pointer = format!("/files/{index}/path");
        let path = file.path.as_str();

        if previous == Some(path) {
            problems.push(problem(
                pointer.clone(),
                format!("'{path}' is listed twice"),
            ));
        } else if let Some(before) =
            previous.filter(|before| compare_bundle_paths(before, path).is_gt())
        {
            problems.push(problem(
                pointer.clone(),
                format!("'{path}' is listed after '{before}'; sort the files by path"),
            ));
        }

        let folded = bundle_path_fold(path);

        if let Some(same_fold) = path_by_fold
            .get(&folded)
            .filter(|same_fold| **same_fold != path)
        {
            problems.push(problem(
                pointer,
                format!("'{path}' differs from '{same_fold}' only in letter case"),
            ));
        }

        path_by_fold.insert(folded, path);
        previous = Some(path);
    }

    problems
}

fn api_problems(manifest: &BundleManifest) -> Vec<BundleManifestProblem> {
    let mut problems = Vec::new();
    let listed: HashSet<&str> = manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let mut api_files: HashSet<&str> = HashSet::new();
    let mut names: HashSet<&str> = HashSet::new();

    for (index, api) in manifest.apis.iter().enumerate() {
        let expected_file = format!("{BUNDLE_IR_DIRECTORY}/{}.json", api.name);

        if names.contains(api.name.as_str()) {
            problems.push(problem(
                format!("/apis/{index}/name"),
                format!("the api '{}' is listed twice", api.name),
            ));
        }

        if api.file != expected_file {
            problems.push(problem(
                format!("/apis/{index}/file"),
                format!(
                    "the file of api '{}' is '{}', not '{expected_file}'",
                    api.name, api.file
                ),
            ));
        } else if !listed.contains(api.file.as_str()) {
            problems.push(problem(
                format!("/apis/{index}/file"),
                format!("'{}' is not in files", api.file),
            ));
        }

        names.insert(&api.name);
        api_files.insert(&api.file);
    }

    let ir_prefix = format!("{BUNDLE_IR_DIRECTORY}/");

    for (index, file) in manifest.files.iter().enumerate() {
        if file.path.starts_with(&ir_prefix) && !api_files.contains(file.path.as_str()) {
            problems.push(problem(
                format!("/files/{index}/path"),
                format!("'{}' is not the file of any api", file.path),
            ));
        }
    }

    problems
}

fn pack_problems(manifest: &BundleManifest) -> Vec<BundleManifestProblem> {
    manifest
        .packs
        .windows(2)
        .enumerate()
        .filter_map(|(offset, pair)| {
            let [previous, pack] = pair else {
                return None;
            };
            let order = compare_bundle_paths(&previous.name, &pack.name)
                .then_with(|| compare_bundle_paths(&previous.version, &pack.version));

            order.is_ge().then(|| {
                problem(
                    format!("/packs/{}", offset + 1),
                    format!(
                        "the pack '{}@{}' is listed twice or out of order; sort the packs by name then version",
                        pack.name, pack.version
                    ),
                )
            })
        })
        .collect()
}
