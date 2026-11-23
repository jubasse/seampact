//! The bundle cases: the bundle of one workspace.

use seampact_bundle::{
    BundleBuildOptions, BundleBuildResult, BundleError, BundleFailure, BundleFile,
    BundleNamedVersionOverride, build_bundle, bundle_manifest_bytes, bundle_tarball,
};
use seampact_json::JsonValue;
use seampact_load::FsReader;
use seampact_oracle::{BundleAnswer, BundleCase, SubjectAnswer, gunzipped_ustar_entries};

use crate::oracle::json::{array_of, coded_problem_json, integer};

/// Why a case gave no answer: the bundle crate failed, or the case could not be set up.
enum CaseError {
    Bundle(BundleError),
    Setup(String),
}

impl From<BundleError> for CaseError {
    fn from(error: BundleError) -> Self {
        Self::Bundle(error)
    }
}

/// Builds the bundle of `case` and lists its files, manifest, integrity and archive.
pub(crate) fn bundle_answer(case: &BundleCase) -> SubjectAnswer<BundleAnswer> {
    match answer_of(case) {
        Ok(answer) => SubjectAnswer::Ported(answer),
        Err(CaseError::Bundle(error)) => SubjectAnswer::InternalError {
            message: error.to_string(),
        },
        Err(CaseError::Setup(message)) => SubjectAnswer::InternalError { message },
    }
}

fn answer_of(case: &BundleCase) -> Result<BundleAnswer, CaseError> {
    let workspace = case
        .directory
        .join(&case.workspace)
        .canonicalize_utf8()
        .map_err(|error| CaseError::Setup(format!("{}: {error}", case.workspace)))?;
    let root = workspace
        .parent()
        .ok_or_else(|| CaseError::Setup(format!("{workspace} has no directory")))?;
    let entry = workspace
        .file_name()
        .ok_or_else(|| CaseError::Setup(format!("{workspace} has no file name")))?;
    let reader = FsReader::new(root).map_err(|error| CaseError::Setup(error.to_string()))?;
    let built = build_bundle(&BundleBuildOptions {
        reader: &reader,
        entry,
        contract: Some(BundleNamedVersionOverride {
            name: case.name.clone(),
            version: case.version.clone(),
        }),
    })?;

    let contents = match built {
        BundleBuildResult::Built { contents, .. } => contents,
        BundleBuildResult::Failed { failures, .. } => {
            return Ok(BundleAnswer::Refused(array_of(&failures, failure_json)));
        }
    };

    let tarball = bundle_tarball(&contents)?;
    let ustar = gunzipped_ustar_entries(&tarball).map_err(CaseError::Setup)?;
    let manifest = String::from_utf8(bundle_manifest_bytes(&contents.manifest))
        .map_err(|error| CaseError::Setup(error.to_string()))?;

    Ok(BundleAnswer::Built {
        files: array_of(&contents.manifest.files, file_json),
        manifest,
        integrity: contents.manifest.integrity.clone(),
        ustar: JsonValue::try_from(ustar).map_err(|error| CaseError::Setup(error.to_string()))?,
    })
}

fn file_json(file: &BundleFile) -> JsonValue {
    JsonValue::object(vec![
        ("path", JsonValue::text(&file.path)),
        (
            "size",
            // A size past i64 is no file a bundle holds; null makes the oracle report it.
            i64::try_from(file.size).map_or(JsonValue::Null, integer),
        ),
        ("sha256", JsonValue::text(&file.sha256)),
    ])
}

fn failure_json(failure: &BundleFailure) -> JsonValue {
    coded_problem_json(
        failure.code.as_str(),
        &failure.message,
        &failure.fix,
        [
            ("file", failure.file.as_deref()),
            ("expected", failure.expected.as_deref()),
            ("actual", failure.actual.as_deref()),
        ],
    )
}
