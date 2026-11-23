//! The files of one entry and api, generated in memory before anything is written.

use camino::Utf8PathBuf;
use seampact_cli_config::CheckLevel;
use seampact_target::{GenerateWarning, GeneratedFile};

/// The files and warnings of one entry and api; `level` is the `checks.generated` that governs
/// their drift, `app` the app of a root run.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedOutput {
    /// The entry id.
    pub entry_id: String,
    /// The api the files were generated from.
    pub api: String,
    /// The output directory.
    pub root: Utf8PathBuf,
    /// The files, finished.
    pub files: Vec<GeneratedFile>,
    /// The forms left to the developer's code.
    pub warnings: Vec<GenerateWarning>,
    /// The level of a drift of these files.
    pub level: CheckLevel,
    /// The app of a root run.
    pub app: Option<String>,
}
