//! The manifest as a verifier reads it: size, UTF-8, JSON, schema, then the rules no schema states.

use std::sync::OnceLock;

use jsonschema::{Draft, Validator};
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir_check::serde_value_through_f64;

use crate::limits::BUNDLE_MANIFEST_BYTES_MAX;
use crate::manifest_rules::bundle_manifest_rule_problems;
use crate::untrusted_json::{
    UntrustedJson, duplicate_key_pointer, parse_untrusted_json, utf8_text,
};
use crate::{BUNDLE_MANIFEST_FILE, BundleError, BundleFailure, BundleFailureCode, BundleManifest};

/// A refusal lists at most this many problems, then how many more there are.
const LISTED_PROBLEM_LIMIT: usize = 5;

const MANIFEST_SCHEMA: &str =
    include_str!("../../../packages/core/spec/schemas/bundle/manifest.schema.json");

static MANIFEST_VALIDATOR: OnceLock<Result<Validator, String>> = OnceLock::new();

/// The manifest a bundle holds, or why it is refused.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleManifestRead {
    /// The manifest passed every check.
    Manifest(BundleManifest),
    /// Why the manifest is refused.
    Refused(BundleFailure),
}

fn build_validator() -> Result<Validator, String> {
    let schema: serde_json::Value = serde_json::from_str(MANIFEST_SCHEMA)
        .map_err(|error| format!("the manifest schema is not JSON: {error}"))?;

    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(false)
        .build(&schema)
        .map_err(|error| format!("the manifest schema does not compile: {error}"))
}

fn validator() -> Result<&'static Validator, InternalError> {
    MANIFEST_VALIDATOR
        .get_or_init(build_validator)
        .as_ref()
        .map_err(|what| InternalError::new(format!("bundle: {what}")))
}

/// The manifest of `bytes`, or why it is refused.
///
/// # Errors
///
/// [`BundleError::Internal`] for a bug: a broken embedded schema, a document that passed it
/// with the wrong shape.
pub fn read_bundle_manifest(bytes: &[u8]) -> Result<BundleManifestRead, BundleError> {
    if bytes.len() > BUNDLE_MANIFEST_BYTES_MAX {
        return Ok(BundleManifestRead::Refused(manifest_too_large(bytes.len())));
    }

    let Some(text) = utf8_text(bytes) else {
        return Ok(refused(&["is not UTF-8 text".to_owned()]));
    };

    let parsed = match parse_untrusted_json(&text) {
        UntrustedJson::Parsed(value) => value,
        UntrustedJson::Refused { problem } => return Ok(refused(&[problem])),
    };

    if let Some(duplicate_at) = duplicate_key_pointer(&text)? {
        return Ok(refused(&[format!(
            "gives the key at {} twice in one object",
            quote_text(&duplicate_at)
        )]));
    }

    let document =
        serde_value_through_f64(&parsed).map_err(|error| InternalError::new(error.to_string()))?;
    let schema_problems: Vec<String> = validator()?
        .iter_errors(&document)
        .map(|error| {
            format!(
                "at {} {error}",
                quote_text(&error.instance_path().to_string())
            )
        })
        .collect();

    if !schema_problems.is_empty() {
        return Ok(refused(&schema_problems));
    }

    let manifest = BundleManifest::from_json_value(&parsed)?;
    let rule_problems: Vec<String> = bundle_manifest_rule_problems(&manifest)
        .iter()
        .map(|problem| format!("at {} {}", quote_text(&problem.pointer), problem.message))
        .collect();

    if !rule_problems.is_empty() {
        return Ok(refused(&rule_problems));
    }

    Ok(BundleManifestRead::Manifest(manifest))
}

fn refused(problems: &[String]) -> BundleManifestRead {
    BundleManifestRead::Refused(invalid_manifest(problems))
}

/// The failure of a manifest over the byte cap.
#[must_use]
pub fn manifest_too_large(size: usize) -> BundleFailure {
    BundleFailure::new(
        BundleFailureCode::ManifestTooLarge,
        format!(
            "'{BUNDLE_MANIFEST_FILE}' holds {size} bytes, over the cap of {BUNDLE_MANIFEST_BYTES_MAX}."
        ),
        "Check that the source names a seampact bundle; a manifest this large is not one.",
    )
    .about(BUNDLE_MANIFEST_FILE)
    .expecting(BUNDLE_MANIFEST_BYTES_MAX.to_string())
    .finding(size.to_string())
}

fn invalid_manifest(problems: &[String]) -> BundleFailure {
    let listed: Vec<&str> = problems
        .iter()
        .take(LISTED_PROBLEM_LIMIT)
        .map(String::as_str)
        .collect();
    let more = problems.len() - listed.len();
    let tail = if more > 0 {
        format!("; and {more} more")
    } else {
        String::new()
    };

    BundleFailure::new(
        BundleFailureCode::ManifestInvalid,
        format!(
            "'{BUNDLE_MANIFEST_FILE}' is not a valid manifest: {}{tail}.",
            listed.join("; ")
        ),
        "Download the bundle again, or rebuild it with `seampact bundle`.",
    )
    .about(BUNDLE_MANIFEST_FILE)
}
