//! What a check over a target's files answers: the files to go on with, or the refusals.

use seampact_target::{GeneratedFile, Refusal};

/// The files after a check, or every refusal the check found.
#[derive(Debug, Clone, PartialEq)]
pub enum FilesOutcome {
    /// Every file passed; the files to go on with.
    Ready(Vec<GeneratedFile>),
    /// At least one file was refused.
    Refused(Vec<Refusal>),
}
