//! One cell of the classification table, its conditions and the outcome it resolves to.

use std::collections::HashSet;
use std::hash::BuildHasher;

use crate::diff_break::DiffBreak;
use crate::diff_classification::DiffClassification;
use crate::diff_kind::DiffKind;
use crate::diff_position::DiffPosition;
use crate::diff_table::DIFF_TABLE;

/// A fact about the two contracts a conditional cell reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffFact {
    /// `afterRefusesUnknownKeys`.
    AfterRefusesUnknownKeys,
    /// `afterRefusesUnknownQuery`.
    AfterRefusesUnknownQuery,
    /// `outputEnumsOpenInBoth`.
    OutputEnumsOpenInBoth,
}

impl DiffFact {
    /// The fact as the table writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AfterRefusesUnknownKeys => "afterRefusesUnknownKeys",
            Self::AfterRefusesUnknownQuery => "afterRefusesUnknownQuery",
            Self::OutputEnumsOpenInBoth => "outputEnumsOpenInBoth",
        }
    }
}

/// A cell with no condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlainCell {
    /// `C`: breaks clients.
    Clients,
    /// `S`: breaks servers.
    Servers,
    /// `CS`: breaks both.
    Both,
    /// `-`: additive.
    Additive,
    /// `info`: reported and never gated.
    Informative,
}

impl PlainCell {
    /// The cell as the table writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clients => "C",
            Self::Servers => "S",
            Self::Both => "CS",
            Self::Additive => "-",
            Self::Informative => "info",
        }
    }
}

/// A cell of the table: plain, or one of two cells chosen by a fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffCell {
    /// A cell with no condition.
    Plain(PlainCell),
    /// `holds` when `when` is among the facts, else `otherwise`.
    Conditional {
        /// The fact read.
        when: DiffFact,
        /// The cell when the fact holds.
        holds: &'static DiffCell,
        /// The cell when it does not.
        otherwise: &'static DiffCell,
    },
}

pub(crate) const CLIENTS: DiffCell = DiffCell::Plain(PlainCell::Clients);
pub(crate) const SERVERS: DiffCell = DiffCell::Plain(PlainCell::Servers);
pub(crate) const BOTH: DiffCell = DiffCell::Plain(PlainCell::Both);
pub(crate) const ADDITIVE: DiffCell = DiffCell::Plain(PlainCell::Additive);
pub(crate) const INFORMATIVE: DiffCell = DiffCell::Plain(PlainCell::Informative);

/// What a cell says about a change: the sides it breaks and its classification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffCellOutcome {
    /// The sides the change breaks.
    pub breaks: Vec<DiffBreak>,
    /// The change's classification.
    pub classification: DiffClassification,
}

/// The rows whose cases are free text (the member changed): one `any` cell set covers them.
const fn is_free_case_kind(kind: DiffKind) -> bool {
    matches!(
        kind,
        DiffKind::Name | DiffKind::Annotation | DiffKind::Unclassified
    )
}

/// The `any` case a free-text row keeps its cells under.
const FREE_CASE: &str = "any";

/// The cell of `kind` and `case_name` at `position`, its conditions read from `facts`; `None` when absent.
///
/// A case name the table does not list is `None`, whatever its text.
#[must_use]
pub fn classify_cell<Hasher: BuildHasher>(
    kind: DiffKind,
    case_name: &str,
    position: DiffPosition,
    facts: &HashSet<DiffFact, Hasher>,
) -> Option<DiffCellOutcome> {
    let (_, cases) = DIFF_TABLE.iter().find(|(row_kind, _)| *row_kind == kind)?;
    let wanted_case = if is_free_case_kind(kind) {
        FREE_CASE
    } else {
        case_name
    };
    let (_, cells) = cases.iter().find(|(name, _)| *name == wanted_case)?;
    let (_, cell) = cells
        .iter()
        .find(|(cell_position, _)| *cell_position == position)?;

    Some(outcome_of(resolve_cell(cell, facts)))
}

fn resolve_cell<Hasher: BuildHasher>(
    cell: &DiffCell,
    facts: &HashSet<DiffFact, Hasher>,
) -> PlainCell {
    match cell {
        DiffCell::Plain(plain) => *plain,
        DiffCell::Conditional {
            when,
            holds,
            otherwise,
        } => resolve_cell(
            if facts.contains(when) {
                holds
            } else {
                otherwise
            },
            facts,
        ),
    }
}

fn outcome_of(cell: PlainCell) -> DiffCellOutcome {
    match cell {
        PlainCell::Clients => DiffCellOutcome {
            breaks: vec![DiffBreak::Clients],
            classification: DiffClassification::Breaking,
        },
        PlainCell::Servers => DiffCellOutcome {
            breaks: vec![DiffBreak::Servers],
            classification: DiffClassification::Breaking,
        },
        PlainCell::Both => DiffCellOutcome {
            breaks: vec![DiffBreak::Clients, DiffBreak::Servers],
            classification: DiffClassification::Breaking,
        },
        PlainCell::Additive => DiffCellOutcome {
            breaks: Vec::new(),
            classification: DiffClassification::Additive,
        },
        PlainCell::Informative => DiffCellOutcome {
            breaks: Vec::new(),
            classification: DiffClassification::Informative,
        },
    }
}
