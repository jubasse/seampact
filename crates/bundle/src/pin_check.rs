//! The second step of the bundle check: the manifest's integrity, then the pin.

use crate::refetch::REFETCH_FIX;
use crate::{BUNDLE_MANIFEST_FILE, BundleFailure, BundleFailureCode, BundleManifest};

/// The failure of the manifest's integrity or of the pin against `integrity`, the one recomputed
/// from the file list; `None` when both agree.
pub(crate) fn check_integrity(
    manifest: &BundleManifest,
    integrity: &str,
    pinned_integrity: Option<&str>,
) -> Option<BundleFailure> {
    if manifest.integrity != integrity {
        return Some(
            BundleFailure::new(
                BundleFailureCode::IntegrityMismatch,
                format!(
                    "The manifest's integrity is {}; its file list gives {integrity}.",
                    manifest.integrity
                ),
                REFETCH_FIX,
            )
            .about(BUNDLE_MANIFEST_FILE)
            .expecting(manifest.integrity.clone())
            .finding(integrity.to_owned()),
        );
    }

    let Some(pinned) = pinned_integrity else {
        return Some(
            BundleFailure::new(
                BundleFailureCode::PinMissing,
                format!("The bundle source pins no integrity; the bundle's is {integrity}."),
                &format!("Review the bundle, then pin it: integrity: {integrity}"),
            )
            .finding(integrity.to_owned()),
        );
    };

    if pinned != integrity {
        return Some(
            BundleFailure::new(
                BundleFailureCode::PinMismatch,
                format!("The pinned integrity is {pinned}; the bundle's is {integrity}."),
                &format!(
                    "Fetch the bundle the pin names, or review this one and pin it: integrity: {integrity}"
                ),
            )
            .expecting(pinned.to_owned())
            .finding(integrity.to_owned()),
        );
    }

    None
}
