//! Contract bundles, ported from `packages/core/spec/src/bundle` and
//! `packages/core/compiler/src/bundle`: [`build_bundle`] builds a bundle from a workspace and
//! [`verify_bundle`] checks one on disk. Nothing here reaches the network.

mod build;
mod bundle_file_check;
mod bundle_ir_check;
mod bundle_walk;
mod contents;
mod error;
mod failure;
mod file_list;
mod installed_package;
mod integrity;
mod label;
mod limits;
mod local_packages;
mod manifest;
mod manifest_read;
mod manifest_rules;
mod path;
mod pin_check;
mod recording_reader;
mod refetch;
mod tarball_read;
mod tarball_write;
mod untrusted_json;
mod ustar;
mod verify;
mod write;

use seampact_diagnostics::RuleId;

pub use build::{BundleBuildOptions, BundleBuildResult, BundleNamedVersionOverride, build_bundle};
pub use contents::{BundleContents, bundle_manifest_bytes};
pub use error::BundleError;
pub use failure::{BundleFailure, BundleFailureCode};
pub use installed_package::{installed_package_directory, resolve_directory};
pub use integrity::{
    BUNDLE_INTEGRITY_PREFIX, bundle_base64_decoded, bundle_hex, bundle_integrity, bundle_sha256_hex,
};
pub use limits::{BUNDLE_ARCHIVE_BYTES_MAX, BUNDLE_ENTRIES_MAX, BUNDLE_EXTRACTED_BYTES_MAX};
pub use local_packages::{LocalPackageReason, LocalPackageSource, find_local_package_sources};
pub(crate) use manifest::{BUNDLE_IR_DIRECTORY, BUNDLE_SOURCES_DIRECTORY, BundleApi};
pub use manifest::{BUNDLE_MANIFEST_FILE, BundleFile, BundleManifest, BundleNamedVersion};
pub(crate) use manifest_read::{BundleManifestRead, manifest_too_large, read_bundle_manifest};
pub use path::{bundle_path_fold, bundle_path_problem};
pub use tarball_read::{
    BundleArchiveExtraction, BundleArchiveRead, ExtractedBundle, extract_bundle_tarball,
    read_bundle_tarball,
};
pub use tarball_write::bundle_tarball;
pub use untrusted_json::{UntrustedJson, parse_untrusted_json};
pub use verify::{BundleChannel, BundleVerifyResult, verify_bundle};
pub use write::{BundleOutput, BundleWriteOptions, BundleWriteResult, write_bundle};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
