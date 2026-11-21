//! The row of an IR definition's member in the classification table.

use crate::diff_kind::DiffKind;
use crate::member_rows_data::MEMBER_ROWS;

/// The row a member's changes land on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MemberRow {
    /// Any change of the member is a change of this row.
    Kind(DiffKind),
    /// Every change of the member is one case of one row.
    Fixed {
        /// The row.
        kind: DiffKind,
        /// The row's case.
        case_name: &'static str,
    },
}

/// A member whose every change is one case of one row.
pub(crate) const fn fixed(kind: DiffKind, case_name: &'static str) -> MemberRow {
    MemberRow::Fixed { kind, case_name }
}

/// The row of `member` of `definition`; `unclassified` for a member the table does not list.
///
/// Unlike the TypeScript lookup, a member named like an `Object.prototype` property
/// (`constructor`, `toString`) is not listed either, so it is `unclassified`.
#[must_use]
pub fn member_row(definition: &str, member: &str) -> MemberRow {
    MEMBER_ROWS
        .iter()
        .find(|(name, _)| *name == definition)
        .and_then(|(_, rows)| rows.iter().find(|(name, _)| *name == member))
        .map_or(MemberRow::Kind(DiffKind::Unclassified), |(_, row)| *row)
}
