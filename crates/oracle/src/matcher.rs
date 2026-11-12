//! Matching mismatches against the entries of `differences.yaml`, and the entries left stale.

use crate::compare::{Mismatch, MismatchKind, pointer_segments};
use crate::glob::entry_glob_matches;
use crate::{Difference, DifferenceChange, OutputFile};

/// The pointer segment of an entry that matches any one segment.
const ANY_SEGMENT: &str = "*";

/// The last pointer segments a `message` change accepts.
const MESSAGE_SEGMENTS: [&str; 2] = ["message", "fix"];

/// The last pointer segments a `code-renamed` change accepts.
const CODE_SEGMENTS: [&str; 3] = ["rule", "code", "id"];

/// Where a compared file sits: its fixture and what the file is.
#[derive(Debug, Clone, Copy)]
pub struct ComparedFile<'file> {
    /// The fixture path under `fixtures/`.
    pub fixture: &'file str,
    /// The file's output, api and half.
    pub file: &'file OutputFile,
}

/// How the entries take one mismatch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchOutcome {
    /// Exactly one entry accepts it.
    Accepted,
    /// No entry accepts it.
    Unmatched,
    /// Two or more entries accept it, by id.
    Ambiguous(Vec<String>),
}

/// The entries of a run, with what each has matched so far.
#[derive(Debug, Clone)]
pub struct DifferenceLedger {
    entries: Vec<LedgerEntry>,
}

#[derive(Debug, Clone)]
struct LedgerEntry {
    difference: Difference,
    /// Whether a compared file was in the entry's scope.
    was_in_scope: bool,
    matched_mismatches: usize,
}

impl DifferenceLedger {
    /// A ledger of `differences`, none matched yet.
    #[must_use]
    pub fn new(differences: Vec<Difference>) -> Self {
        let entries = differences
            .into_iter()
            .map(|difference| LedgerEntry {
                difference,
                was_in_scope: false,
                matched_mismatches: 0,
            })
            .collect();

        Self { entries }
    }

    /// Records that `compared` was compared, so the entries in its scope can go stale.
    pub fn record_compared(&mut self, compared: ComparedFile<'_>) {
        for entry in &mut self.entries {
            if is_in_scope(&entry.difference, compared) {
                entry.was_in_scope = true;
            }
        }
    }

    /// How the entries take `mismatch` in `compared`; each entry that accepts it counts it.
    pub fn take(&mut self, compared: ComparedFile<'_>, mismatch: &Mismatch) -> MatchOutcome {
        let mut accepting_ids = Vec::new();

        for entry in &mut self.entries {
            if entry_matches(&entry.difference, compared, mismatch) {
                entry.matched_mismatches += 1;
                accepting_ids.push(entry.difference.id.clone());
            }
        }

        match accepting_ids.len() {
            0 => MatchOutcome::Unmatched,
            1 => MatchOutcome::Accepted,
            _ => MatchOutcome::Ambiguous(accepting_ids),
        }
    }

    /// The ids of the entries whose scope held a compared file and that matched no mismatch.
    #[must_use]
    pub fn stale_ids(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter(|entry| entry.was_in_scope && entry.matched_mismatches == 0)
            .map(|entry| entry.difference.id.as_str())
            .collect()
    }
}

/// Whether a compared file is in an entry's scope: fixture glob, output, api and half.
fn is_in_scope(difference: &Difference, compared: ComparedFile<'_>) -> bool {
    let applies = &difference.applies;

    let fixture_matches = applies
        .fixtures
        .iter()
        .any(|glob| entry_glob_matches(glob, compared.fixture));
    let api_matches = applies.api.is_none() || applies.api == compared.file.api;
    let half_matches = applies.half.is_none() || applies.half == compared.file.half;

    fixture_matches && applies.output == compared.file.output && api_matches && half_matches
}

/// Whether an entry accepts a mismatch, as `scripts/oracle/README.md` states.
#[must_use]
pub fn entry_matches(
    difference: &Difference,
    compared: ComparedFile<'_>,
    mismatch: &Mismatch,
) -> bool {
    let (Some(entry_pointer), Some(mismatch_pointer)) =
        (&difference.applies.pointer, &mismatch.pointer)
    else {
        return false;
    };

    let from_matches = difference.from.is_none() || difference.from == mismatch.expected;
    let to_matches = difference.to.is_none() || difference.to == mismatch.actual;

    is_in_scope(difference, compared)
        && pointer_matches(entry_pointer, mismatch_pointer)
        && change_matches(difference.change, mismatch)
        && from_matches
        && to_matches
}

/// Whether a pointer matches an entry's pointer segment by segment, `*` matching any one segment.
fn pointer_matches(entry_pointer: &str, mismatch_pointer: &str) -> bool {
    let entry_segments: Vec<&str> = entry_pointer.split('/').collect();
    let mismatch_segments: Vec<&str> = mismatch_pointer.split('/').collect();

    entry_segments.len() == mismatch_segments.len()
        && entry_segments
            .iter()
            .zip(&mismatch_segments)
            .all(|(entry_segment, mismatch_segment)| {
                *entry_segment == ANY_SEGMENT || entry_segment == mismatch_segment
            })
}

fn change_matches(change: DifferenceChange, mismatch: &Mismatch) -> bool {
    let last_segment = mismatch
        .pointer
        .as_deref()
        .map(pointer_segments)
        .and_then(|segments| segments.last().cloned());
    let last_segment_is = |names: &[&str]| {
        last_segment
            .as_deref()
            .is_some_and(|segment| names.contains(&segment))
    };

    match change {
        DifferenceChange::Value => mismatch.kind == MismatchKind::Value,
        DifferenceChange::Added => mismatch.kind == MismatchKind::Added,
        DifferenceChange::Removed => mismatch.kind == MismatchKind::Removed,
        DifferenceChange::Message => {
            mismatch.kind == MismatchKind::Value && last_segment_is(&MESSAGE_SEGMENTS)
        }
        DifferenceChange::CodeRenamed => {
            mismatch.kind == MismatchKind::Value && last_segment_is(&CODE_SEGMENTS)
        }
        DifferenceChange::Format => false,
    }
}
