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

/// What one entry and api generated, before the run adds the level of its drift and its app.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedApi {
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
}

impl GeneratedApi {
    /// The output of a run: these files under the `level` of their drift, for `app` of a root run.
    #[must_use]
    pub fn into_output(self, level: CheckLevel, app: Option<&str>) -> GeneratedOutput {
        GeneratedOutput {
            entry_id: self.entry_id,
            api: self.api,
            root: self.root,
            files: self.files,
            warnings: self.warnings,
            level,
            app: app.map(str::to_owned),
        }
    }
}
