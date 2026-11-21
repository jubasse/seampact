//! The bundle cases: the bundle of one workspace.

use seampact_bundle::{
    BundleBuildOptions, BundleBuildResult, BundleError, BundleFailure, BundleFile,
    BundleNamedVersionOverride, build_bundle, bundle_manifest_bytes, bundle_tarball,
};
use seampact_json::{JsonNumber, JsonObject, JsonValue};
use seampact_load::FsReader;
use seampact_oracle::{BundleAnswer, BundleCase, SubjectAnswer, gunzipped_ustar_entries};

use crate::oracle::stub_answer::{StubError, failed_answer};

impl StubError for BundleError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

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
        Err(CaseError::Bundle(error)) => failed_answer(&error),
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

    let BundleBuildResult::Built { contents, .. } = built else {
        let BundleBuildResult::Failed { failures, .. } = built else {
            return Err(CaseError::Setup("the build answered neither way".to_owned()));
        };

        return Ok(BundleAnswer::Refused(JsonValue::Array(
            failures.iter().map(failure_json).collect(),
        )));
    };

    let tarball = bundle_tarball(&contents)?;
    let ustar = gunzipped_ustar_entries(&tarball).map_err(CaseError::Setup)?;
    let manifest = String::from_utf8(bundle_manifest_bytes(&contents.manifest))
        .map_err(|error| CaseError::Setup(error.to_string()))?;

    Ok(BundleAnswer::Built {
        files: JsonValue::Array(contents.manifest.files.iter().map(file_json).collect()),
        manifest,
        integrity: contents.manifest.integrity.clone(),
        ustar: JsonValue::try_from(ustar).map_err(|error| CaseError::Setup(error.to_string()))?,
    })
}

fn members(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    let mut object = JsonObject::new();

    for (key, value) in entries {
        object.insert(key.to_owned(), value);
    }

    JsonValue::Object(object)
}

fn text(value: &str) -> JsonValue {
    JsonValue::String(value.to_owned())
}

fn file_json(file: &BundleFile) -> JsonValue {
    members(vec![
        ("path", text(&file.path)),
        (
            "size",
            JsonNumber::from_json_text(&file.size.to_string())
                .map_or(JsonValue::Null, JsonValue::Number),
        ),
        ("sha256", text(&file.sha256)),
    ])
}

fn failure_json(failure: &BundleFailure) -> JsonValue {
    let mut entries = vec![
        ("code", text(failure.code.as_str())),
        ("message", text(&failure.message)),
        ("fix", text(&failure.fix)),
    ];

    for (key, value) in [
        ("file", &failure.file),
        ("expected", &failure.expected),
        ("actual", &failure.actual),
    ] {
        if let Some(found) = value {
            entries.push((key, text(found)));
        }
    }

    members(entries)
}
