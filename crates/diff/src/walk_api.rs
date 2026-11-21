//! The comparison of the api member and of the packs.

use std::collections::{HashMap, HashSet};

use seampact_ir::PackRef;

use crate::DiffError;
use crate::not_ported::not_ported_yet;
use crate::walk_context::WalkContext;

/// The names of the packs whose version differs between the two sides, or that only one has.
pub(crate) fn changed_pack_names(before: &[PackRef], after: &[PackRef]) -> HashSet<String> {
    let versions = |packs: &'_ [PackRef]| -> HashMap<String, String> {
        packs
            .iter()
            .map(|pack| (pack.name.clone(), pack.version.clone()))
            .collect()
    };
    let before_versions = versions(before);
    let after_versions = versions(after);

    before_versions
        .keys()
        .chain(after_versions.keys())
        .filter(|name| before_versions.get(*name) != after_versions.get(*name))
        .cloned()
        .collect()
}

/// Compares the api member of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_api(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareApi"))
}

/// Compares the two lists of packs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_packs(
    _context: &mut WalkContext<'_>,
    _before: &[PackRef],
    _after: &[PackRef],
) -> Result<(), DiffError> {
    Err(not_ported_yet("comparePacks"))
}
