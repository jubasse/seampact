//! The tool side of the oracle: what a subject answers for each tool case of layer 3.2.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_json::JsonValue;

use crate::{
    BundleCase, CliCase, CliCommand, DiffCase, Fixture, MergeCase, RuleIdRegistry, SubjectAnswer,
};

/// What emitting OpenAPI documents gave: the documents, or the refusals.
#[derive(Debug, Clone, PartialEq)]
pub enum OpenApiAnswer {
    /// Each document's name (`default` for the one document of an api that declares none) and
    /// its YAML text, in emit order.
    Documents(Vec<(String, String)>),
    /// The refusals, `[{ "code", "message", "fix", "operation"?, "member"?, "docs"? }]`.
    Refusals(JsonValue),
}

/// What a diff case gave: the result as `JSON.stringify` writes it and the report text.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffAnswer {
    /// The value of `diff/result.json`.
    pub result: JsonValue,
    /// The text of `diff/report.txt`.
    pub report: String,
}

/// What a bundle case gave: the bundle's files, or the failures.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleAnswer {
    /// The bundle was built.
    Built {
        /// The value of `bundle/files.json`.
        files: JsonValue,
        /// The manifest's text, `bundle/manifest.json`.
        manifest: String,
        /// The integrity, without the newline of `bundle/integrity.txt`.
        integrity: String,
        /// The value of `bundle/ustar.json`.
        ustar: JsonValue,
    },
    /// The value of `bundle/refusals.json`: the failures as the build returns them.
    Refused(JsonValue),
}

/// The library a recorded call of a CLI case belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RecordedUnit {
    /// The config readers.
    CliConfig,
    /// The editor schemas.
    EditorSchemas,
    /// The bundle fetch and the workspace imports.
    BundleFetch,
}

impl RecordedUnit {
    /// Every unit, in the order the verdict lists them.
    pub const ALL: [Self; 3] = [Self::CliConfig, Self::EditorSchemas, Self::BundleFetch];

    /// The unit's directory below a CLI case's expected directory, and its `--tool` name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CliConfig => "cli-config",
            Self::EditorSchemas => "editor-schemas",
            Self::BundleFetch => "bundle-fetch",
        }
    }
}

/// One recorded call: the TypeScript function name and its arguments as `JSON.stringify` wrote
/// them, every absolute path written `<root>/...`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedToolCall {
    /// The `function` member.
    pub function: String,
    /// The `args` member.
    pub args: Vec<JsonValue>,
}

/// What replaying a recorded call gave.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedAnswer {
    /// The answer as `JSON.stringify` writes it.
    pub result: JsonValue,
    /// The bytes of each file the call created or changed, by path relative to the run root.
    pub written: IndexMap<String, Vec<u8>>,
}

/// What running a CLI case gave, paths relative to the run root; the harness writes the run root
/// `<root>` in both streams before it compares them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    /// The exit code.
    pub exit: i32,
    /// Everything printed on stdout.
    pub stdout: String,
    /// Everything printed on stderr.
    pub stderr: String,
    /// The bytes of each file the command created or changed; the harness hashes them.
    pub written: IndexMap<String, Vec<u8>>,
    /// Each file the command removed.
    pub removed: Vec<String>,
}

/// The tools of layer 3.2 the oracle checks beside the compiler.
///
/// Every answer may be [`SubjectAnswer::NotPorted`] while the entry it calls is a stub.
pub trait ToolSubject {
    /// Emits the documents of the IR `ir` under the raw emitter options `options` (the defaults
    /// when absent).
    fn openapi(&self, ir: &JsonValue, options: Option<&JsonValue>) -> SubjectAnswer<OpenApiAnswer>;

    /// Merges the documents of a merge case; the answer holds one document named `merged`.
    fn openapi_merge(&self, case: &MergeCase) -> SubjectAnswer<OpenApiAnswer>;

    /// Lints `api` of `fixture`, compiled by the subject; the diagnostics as a JSON array in the
    /// shape and order of `diagnostics.json` entries.
    fn lint(&self, fixture: &Fixture, api: &str) -> SubjectAnswer<JsonValue>;

    /// The diff codes and table, `{ "codes", "table" }`.
    fn diff_table(&self) -> SubjectAnswer<JsonValue>;

    /// Compiles both sides of a diff case and diffs them.
    fn diff(&self, case: &DiffCase) -> SubjectAnswer<DiffAnswer>;

    /// Builds the bundle of a bundle case.
    fn bundle(&self, case: &BundleCase) -> SubjectAnswer<BundleAnswer>;

    /// Replays one recorded call on `root`, a fresh copy of the case's tree as it was before the
    /// command.
    fn recorded_call(
        &self,
        unit: RecordedUnit,
        call: &RecordedToolCall,
        root: &Utf8Path,
    ) -> SubjectAnswer<RecordedAnswer>;

    /// Runs `command`, one command of a CLI case, in `root`: a copy of the case's tree the harness
    /// owns, as the case's earlier steps left it.
    fn cli(
        &self,
        case: &CliCase,
        command: &CliCommand,
        root: &Utf8Path,
    ) -> SubjectAnswer<Transcript>;

    /// The rule ids each tool crate declares.
    fn rule_id_registry(&self) -> RuleIdRegistry;
}
