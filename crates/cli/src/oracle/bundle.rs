//! The bundle cases: the bundle of one workspace.

use seampact_oracle::{BundleAnswer, BundleCase, SubjectAnswer};

/// Builds the bundle of `case`. The brief that ports `buildBundle` builds its options and lists
/// the archive with `seampact_oracle::ustar_entries` here.
pub(crate) fn bundle_answer(_case: &BundleCase) -> SubjectAnswer<BundleAnswer> {
    SubjectAnswer::NotPorted
}
