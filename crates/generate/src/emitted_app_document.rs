//! One OpenAPI document of an app, rendered and placed, before it is written.

use camino::Utf8PathBuf;
use seampact_cli_config::CheckLevel;

/// A rendered document: its name, its file, its text and the `checks.openapi` of its drift.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedAppDocument {
    /// The document name of the plan.
    pub name: String,
    /// The file it is written to.
    pub file: Utf8PathBuf,
    /// The YAML text.
    pub text: String,
    /// The level of a drift of this document.
    pub level: CheckLevel,
}
