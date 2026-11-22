//! A problem with the key path it concerns, so a schema failure at that path is not reported twice.

use crate::CliProblem;
use crate::key_path::KeyPath;

/// A problem found before the schema check, and the key path it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyProblem {
    pub(crate) path: KeyPath,
    pub(crate) problem: CliProblem,
}
