//! The verdict of a tool run: one count line per tool, the problems and the first failing mismatch.

use std::fmt;

use crate::{FirstFailure, Tool};

/// The counts of one tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolTally {
    /// The tool.
    pub tool: Tool,
    /// The cases selected; a recorded unit counts each recorded call.
    pub cases: usize,
    /// The cases whose every compared file matches.
    pub matching: usize,
    /// The cases with a mismatch no difference accepts, or an internal error.
    pub differing: usize,
    /// The cases the subject answered as not ported.
    pub not_ported: usize,
}

impl ToolTally {
    /// A tally of `tool` with nothing counted.
    #[must_use]
    pub const fn new(tool: Tool) -> Self {
        Self {
            tool,
            cases: 0,
            matching: 0,
            differing: 0,
            not_ported: 0,
        }
    }
}

impl fmt::Display for ToolTally {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: {} cases, {} match, {} differ, {} not ported",
            self.tool.as_str(),
            self.cases,
            self.matching,
            self.differing,
            self.not_ported
        )
    }
}

/// The outcome of one tool run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolVerdict {
    /// One tally per selected tool, in [`Tool::ALL`] order.
    pub tallies: Vec<ToolTally>,
    /// The first mismatch no difference accepts.
    pub first_failure: Option<FirstFailure>,
    /// The problems that fail the run besides mismatches: internal errors, stale differences.
    pub problems: Vec<String>,
}

impl ToolVerdict {
    /// Whether the run passes: no failing mismatch and no problem.
    #[must_use]
    pub fn passed(&self) -> bool {
        self.first_failure.is_none() && self.problems.is_empty()
    }

    /// The cases selected over every tool.
    #[must_use]
    pub fn cases(&self) -> usize {
        self.tallies.iter().map(|tally| tally.cases).sum()
    }
}

impl fmt::Display for ToolVerdict {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lines: Vec<String> = self.tallies.iter().map(ToString::to_string).collect();

        write!(formatter, "{}", lines.join("\n"))?;

        for problem in &self.problems {
            write!(formatter, "\noracle: {problem}")?;
        }

        if let Some(failure) = &self.first_failure {
            write!(formatter, "\n{failure}")?;
        }

        Ok(())
    }
}
