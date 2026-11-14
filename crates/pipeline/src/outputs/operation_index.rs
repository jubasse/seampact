//! The position of an operation in the draft, the key of a half's per-operation output.

/// The position of an operation in `draft.operations`.
///
/// Only [`DraftIr::operation_indices`](crate::DraftIr::operation_indices) builds one, so an index
/// into another list cannot address an operation of the draft or of a half's output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OperationIndex(usize);

impl OperationIndex {
    /// The index at `position`; only the walk over the draft operations calls it.
    pub(crate) const fn new(position: usize) -> Self {
        Self(position)
    }

    /// The position in `draft.operations`, and in a half output's per-operation list.
    #[must_use]
    pub const fn position(self) -> usize {
        self.0
    }
}
