//! The `operations` filter of a target entry: operation ids or tags kept or dropped.

use serde::Deserialize;

/// Operation ids or tags; an empty or absent `include` keeps every operation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Deserialize)]
pub struct OperationsFilter {
    /// The ids or tags kept.
    #[serde(default)]
    pub include: Option<Vec<String>>,
    /// The ids or tags dropped.
    #[serde(default)]
    pub exclude: Option<Vec<String>>,
}
