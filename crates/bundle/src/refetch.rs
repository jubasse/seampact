//! The fix every failure of a tampered or damaged bundle directory gives.

/// What to do when a file of a fetched bundle differs from its manifest.
pub(crate) const REFETCH_FIX: &str = "Fetch the bundle again from its source; if it fails again, the source holds a tampered bundle.";
