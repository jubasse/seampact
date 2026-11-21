//! Contract bundles, ported from `packages/core/spec/src/bundle` and
//! `packages/core/compiler/src/bundle`: [`build_bundle`] builds a bundle from a workspace and
//! [`verify_bundle`] checks one on disk. Nothing here reaches the network.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod build;
mod contents;
mod error;
mod failure;
mod file_list;
mod integrity;
mod label;
mod limits;
mod manifest;
mod manifest_read;
mod manifest_rules;
mod not_ported;
mod path;
mod recording_reader;
mod source;
mod tarball_read;
mod tarball_write;
mod untrusted_json;
mod ustar;
mod verify;
mod write;

use seampact_diagnostics::RuleId;

pub use build::{BundleBuildOptions, BundleBuildResult, BundleNamedVersionOverride, build_bundle};
pub use contents::{BundleContents, BundleEntry, bundle_entries, bundle_manifest_bytes};
pub use error::BundleError;
pub use failure::{BundleFailure, BundleFailureCode};
pub use file_list::{canonical_bundle_file_list, compare_bundle_paths};
pub use integrity::{bundle_integrity, bundle_sha256_hex};
pub use label::bundle_label_problem;
pub use limits::{
    BUNDLE_ARCHIVE_BYTES_MAX, BUNDLE_ENTRIES_MAX, BUNDLE_EXTRACTED_BYTES_MAX,
    BUNDLE_MANIFEST_BYTES_MAX,
};
pub use manifest::{
    BUNDLE_FORMAT_VERSION, BUNDLE_IR_DIRECTORY, BUNDLE_MANIFEST_FILE, BUNDLE_SOURCES_DIRECTORY,
    BundleApi, BundleFile, BundleManifest, BundleNamedVersion,
};
pub use manifest_read::{BundleManifestRead, manifest_too_large, read_bundle_manifest};
pub use manifest_rules::{BundleManifestProblem, bundle_manifest_rule_problems};
pub use path::{BUNDLE_PATH_MAX_LENGTH, bundle_path_fold, bundle_path_problem};
pub use source::BundleSource;
pub use tarball_read::{
    BundleArchiveExtraction, BundleArchiveRead, extract_bundle_tarball, read_bundle_tarball,
};
pub use tarball_write::bundle_tarball;
pub use untrusted_json::{UntrustedJson, duplicate_key_pointer, parse_untrusted_json, utf8_text};
pub use verify::{BundleChannel, BundleVerifyResult, verify_bundle};
pub use write::{BundleOutput, BundleWriteOptions, BundleWriteResult, write_bundle};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
