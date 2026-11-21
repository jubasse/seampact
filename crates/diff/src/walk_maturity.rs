//! Maturity levels in the order of their promise.

use seampact_ir::Maturity;

/// Whether `level` is one this diff ranks.
pub(crate) fn is_known_maturity(level: &Maturity) -> bool {
    !matches!(level, Maturity::Unknown(_))
}
