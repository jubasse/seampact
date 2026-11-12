//! The verdict of a run: its counts, the problems that fail it and the first failing mismatch.

use std::fmt;

use crate::{RuleIdCheck, StagePorting};

/// The first mismatch no difference accepts, with the lines around it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirstFailure {
    /// The fixture path under `fixtures/`.
    pub fixture: String,
    /// The file under the fixture's expected directory.
    pub file: String,
    /// The JSON Pointer, absent for a text-only difference.
    pub pointer: Option<String>,
    /// What differs, in one line.
    pub summary: String,
    /// The expected lines around it, numbered.
    pub expected_context: Vec<String>,
    /// The compiled lines around it, numbered.
    pub actual_context: Vec<String>,
}

/// The outcome of one oracle run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Verdict {
    /// The fixtures selected.
    pub fixtures: usize,
    /// The fixtures whose every compared file matches.
    pub matching: usize,
    /// The fixtures with a mismatch no difference accepts.
    pub differing: usize,
    /// The fixtures with no file compared: every answer was not ported.
    pub not_ported: usize,
    /// The first mismatch no difference accepts.
    pub first_failure: Option<FirstFailure>,
    /// The problems that fail the run besides mismatches: stale differences, the tree.
    pub problems: Vec<String>,
    /// The rule ids of the subject's stages against the coverage keys.
    pub rule_ids: Option<RuleIdCheck>,
}

impl Verdict {
    /// The fixtures with at least one file compared.
    #[must_use]
    pub fn compared(&self) -> usize {
        self.matching + self.differing
    }

    /// Whether the run passes: no failing mismatch and no problem.
    #[must_use]
    pub fn passed(&self) -> bool {
        let rule_ids_pass = self
            .rule_ids
            .as_ref()
            .is_none_or(|check| check.problems.is_empty());

        self.first_failure.is_none() && self.problems.is_empty() && rule_ids_pass
    }
}

impl fmt::Display for Verdict {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "oracle: {} fixtures, {} compared, {} match, {} differ, {} not ported",
            self.fixtures,
            self.compared(),
            self.matching,
            self.differing,
            self.not_ported
        )?;

        if let Some(check) = &self.rule_ids {
            if check.porting == StagePorting::Partial {
                write!(
                    formatter,
                    "\nrule ids: {} of {} declared",
                    check.declared, check.total
                )?;
            }

            for problem in &check.problems {
                write!(formatter, "\noracle: {problem}")?;
            }
        }

        for problem in &self.problems {
            write!(formatter, "\noracle: {problem}")?;
        }

        if let Some(failure) = &self.first_failure {
            write!(formatter, "\n{failure}")?;
        }

        Ok(())
    }
}

impl fmt::Display for FirstFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "first mismatch: {}\n  file: {}",
            self.fixture, self.file
        )?;

        if let Some(pointer) = &self.pointer {
            let shown_pointer = if pointer.is_empty() {
                "(root)"
            } else {
                pointer
            };

            write!(formatter, "\n  pointer: {shown_pointer}")?;
        }

        write!(formatter, "\n  {}", self.summary)?;

        if self.expected_context.is_empty() && self.actual_context.is_empty() {
            return Ok(());
        }

        write!(formatter, "\n  expected:")?;

        for line in &self.expected_context {
            write!(formatter, "\n{line}")?;
        }

        write!(formatter, "\n  actual:")?;

        for line in &self.actual_context {
            write!(formatter, "\n{line}")?;
        }

        Ok(())
    }
}
