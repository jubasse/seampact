//! The tool cases of layer 3.2 and their expected files, read as `scripts/oracle/README.md` ("Tool
//! outputs") writes them.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_json::{JsonObject, JsonValue};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{EXPECTED_DIRECTORY, FIXTURES_DIRECTORY, Fixture, OracleError, RecordedToolCall};

/// The `today` of a diff case without `diff.options.json`, and of every CLI case.
pub const CASE_TODAY: &str = "2026-01-01";

/// The tools of layer 3.2, by their `--tool` name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Tool {
    /// `openapi`.
    Openapi,
    /// `openapi-merge`.
    OpenapiMerge,
    /// `lint`.
    Lint,
    /// `diff-table`.
    DiffTable,
    /// `diff`.
    Diff,
    /// `bundle`.
    Bundle,
    /// `cli-config`.
    CliConfig,
    /// `editor-schemas`.
    EditorSchemas,
    /// `bundle-fetch`.
    BundleFetch,
    /// `cli`.
    Cli,
}

impl Tool {
    /// Every tool, in the order the verdict lists them.
    pub const ALL: [Self; 10] = [
        Self::Openapi,
        Self::OpenapiMerge,
        Self::Lint,
        Self::DiffTable,
        Self::Diff,
        Self::Bundle,
        Self::CliConfig,
        Self::EditorSchemas,
        Self::BundleFetch,
        Self::Cli,
    ];

    /// The `--tool` name, also the unit directory of its expected files.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Openapi => "openapi",
            Self::OpenapiMerge => "openapi-merge",
            Self::Lint => "lint",
            Self::DiffTable => "diff-table",
            Self::Diff => "diff",
            Self::Bundle => "bundle",
            Self::CliConfig => "cli-config",
            Self::EditorSchemas => "editor-schemas",
            Self::BundleFetch => "bundle-fetch",
            Self::Cli => "cli",
        }
    }

    /// The tool a `--tool` name names.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tool| tool.as_str() == name)
    }
}

/// One input of a merge case, its IR read from the expected files.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeCaseInput {
    /// The api name.
    pub api: String,
    /// The `api.documents` key the input names.
    pub document: Option<String>,
    /// The expected `ir/<api>.json` of the input's fixture, kept to the listed operations.
    pub ir: JsonValue,
}

/// A merge case: `fixtures/openapi-merge/<case>/merge.json` with each input's IR read.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeCase {
    /// The case path under `fixtures/`.
    pub path: String,
    /// The merged document's name.
    pub name: String,
    /// The prefix of each api.
    pub prefix: IndexMap<String, String>,
    /// The raw emitter options, which go through the options parser.
    pub emitter: Option<JsonValue>,
    /// The inputs, in file order.
    pub inputs: Vec<MergeCaseInput>,
}

/// A diff case: two fixtures and the raw diff options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffCase {
    /// The case path under `fixtures/`.
    pub path: String,
    /// The `before/` fixture.
    pub before: Fixture,
    /// The `after/` fixture.
    pub after: Fixture,
    /// The value of `diff.options.json`, `{ "today": "2026-01-01" }` when absent.
    pub options: JsonValue,
}

/// A bundle case: a workspace and `bundle.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleCase {
    /// The case path under `fixtures/`.
    pub path: String,
    /// The case directory.
    pub directory: Utf8PathBuf,
    /// The workspace file, relative to the case directory.
    pub workspace: String,
    /// The contract name over the case's `package.json`.
    pub name: Option<String>,
    /// The contract version over the case's `package.json`.
    pub version: Option<String>,
}

/// A CLI case: `cli.json`, run in a fresh copy of the case's `tree/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliCase {
    /// The case path under `fixtures/`.
    pub path: String,
    /// The case directory, holding `tree/` and, for the git channel, `git-source/`.
    pub directory: Utf8PathBuf,
    /// The arguments after the binary name.
    pub argv: Vec<String>,
    /// The working directory, relative to the run root.
    pub cwd: String,
    /// `SEAMPACT_CACHE_DIR`, relative to the run root; `.cache` when the case sets none.
    pub cache_directory: String,
    /// `SEAMPACT_ALLOW_LOCAL`, when set.
    pub allow_local: Option<String>,
}

/// An expected file a command or a recorded call wrote: its hash, its text when UTF-8, its listing
/// when an archive.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedWrittenFile {
    /// The lowercase hexadecimal SHA-256 of the bytes.
    pub sha256: String,
    /// The text, when the file is UTF-8.
    pub text: Option<String>,
    /// The listing of a `.tgz`, gunzipped, as `bundle/ustar.json`; its hash is then not compared.
    pub ustar: Option<Value>,
}

/// `<unit>/<NN>-<function>.json`: one recorded call and what it gave.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedToolFile {
    /// The call to replay.
    pub call: RecordedToolCall,
    /// The expected answer.
    pub result: JsonValue,
    /// The files the call created or changed.
    pub written: IndexMap<String, ExpectedWrittenFile>,
}

/// `cli/transcript.json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedTranscript {
    /// The exit code.
    pub exit: i32,
    /// Everything printed on stdout.
    pub stdout: String,
    /// Everything printed on stderr.
    pub stderr: String,
    /// Each file the command created or changed, sorted by path.
    pub written: IndexMap<String, ExpectedWrittenFile>,
    /// Each file the command removed.
    pub removed: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MergeFile {
    name: String,
    prefix: IndexMap<String, String>,
    emitter: Option<JsonValue>,
    inputs: Vec<MergeFileInput>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MergeFileInput {
    fixture: String,
    api: String,
    document: Option<String>,
    operations: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BundleFile {
    workspace: Option<String>,
    name: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CliFile {
    argv: Vec<String>,
    cwd: Option<String>,
    #[serde(default)]
    env: CliFileEnvironment,
}

/// The variables a CLI case may set; any other name is refused.
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct CliFileEnvironment {
    #[serde(rename = "SEAMPACT_CACHE_DIR")]
    cache_directory: Option<String>,
    #[serde(rename = "SEAMPACT_ALLOW_LOCAL")]
    allow_local: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordedFile {
    function: String,
    args: Vec<JsonValue>,
    result: JsonValue,
    #[serde(default)]
    written: IndexMap<String, ExpectedWrittenFile>,
}

const DEFAULT_WORKSPACE_FILE: &str = "workspace.yaml";

const DEFAULT_CACHE_DIRECTORY: &str = ".cache";

/// Reads `merge.json` of the case at `case_path` and the expected IR of each input.
///
/// # Errors
///
/// When a file cannot be read, is no JSON, or has another shape.
pub fn read_merge_case(
    repository_root: &Utf8Path,
    case_path: &str,
) -> Result<MergeCase, OracleError> {
    let file_path = repository_root
        .join(FIXTURES_DIRECTORY)
        .join(case_path)
        .join("merge.json");
    let file: MergeFile = read_case_file(&file_path)?;

    let inputs = file
        .inputs
        .into_iter()
        .map(|input| {
            let ir_path = repository_root
                .join(EXPECTED_DIRECTORY)
                .join(&input.fixture)
                .join("ir")
                .join(format!("{}.json", input.api));
            let ir: serde_json::Value = read_case_file(&ir_path)?;
            let ir = JsonValue::try_from(kept_operations(ir, input.operations.as_deref()))
                .map_err(|error| OracleError::Shape {
                    path: ir_path.clone(),
                    problem: error.to_string(),
                })?;

            Ok(MergeCaseInput {
                ir,
                api: input.api,
                document: input.document,
            })
        })
        .collect::<Result<Vec<_>, OracleError>>()?;

    Ok(MergeCase {
        path: case_path.to_owned(),
        name: file.name,
        prefix: file.prefix,
        emitter: file.emitter,
        inputs,
    })
}

/// The IR with its `operations` kept to the listed ids, in IR order; every one when absent.
fn kept_operations(mut ir: serde_json::Value, operations: Option<&[String]>) -> serde_json::Value {
    let Some(kept_ids) = operations else {
        return ir;
    };

    if let Some(serde_json::Value::Array(listed)) = ir.get_mut("operations") {
        listed.retain(|operation| {
            operation
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| kept_ids.iter().any(|kept| kept == id))
        });
    }

    ir
}

/// Reads the diff case at `case_path`: its two fixtures and `diff.options.json`.
///
/// # Errors
///
/// When the options file cannot be read or is no JSON object.
pub fn read_diff_case(
    repository_root: &Utf8Path,
    case_path: &str,
) -> Result<DiffCase, OracleError> {
    let directory = repository_root.join(FIXTURES_DIRECTORY).join(case_path);
    let options_path = directory.join("diff.options.json");

    let options = if options_path.exists() {
        read_case_file::<JsonValue>(&options_path)?
    } else {
        let mut defaults = JsonObject::new();

        defaults.insert("today".to_owned(), JsonValue::String(CASE_TODAY.to_owned()));

        JsonValue::Object(defaults)
    };

    if !matches!(options, JsonValue::Object(_)) {
        return Err(OracleError::Shape {
            path: options_path,
            problem: "the diff options are a JSON object".to_owned(),
        });
    }

    Ok(DiffCase {
        path: case_path.to_owned(),
        before: side_fixture(&directory, case_path, "before"),
        after: side_fixture(&directory, case_path, "after"),
        options,
    })
}

fn side_fixture(case_directory: &Utf8Path, case_path: &str, side: &str) -> Fixture {
    let directory = case_directory.join(side);
    let entry = if directory.join(DEFAULT_WORKSPACE_FILE).exists() {
        DEFAULT_WORKSPACE_FILE
    } else {
        "api.yaml"
    };

    Fixture {
        path: format!("{case_path}/{side}"),
        directory,
        entry: entry.to_owned(),
    }
}

/// Reads `bundle.json` of the case at `case_path`.
///
/// # Errors
///
/// When the file cannot be read, is no JSON, or has another shape.
pub fn read_bundle_case(
    repository_root: &Utf8Path,
    case_path: &str,
) -> Result<BundleCase, OracleError> {
    let directory = repository_root.join(FIXTURES_DIRECTORY).join(case_path);
    let file: BundleFile = read_case_file(&directory.join("bundle.json"))?;

    Ok(BundleCase {
        path: case_path.to_owned(),
        workspace: file
            .workspace
            .unwrap_or_else(|| DEFAULT_WORKSPACE_FILE.to_owned()),
        name: file.name,
        version: file.version,
        directory,
    })
}

/// Reads `cli.json` of the case at `case_path`; an environment variable other than the two a
/// case may set is refused.
///
/// # Errors
///
/// When the file cannot be read, is no JSON, or has another shape.
pub fn read_cli_case(repository_root: &Utf8Path, case_path: &str) -> Result<CliCase, OracleError> {
    let directory = repository_root.join(FIXTURES_DIRECTORY).join(case_path);
    let file: CliFile = read_case_file(&directory.join("cli.json"))?;

    Ok(CliCase {
        path: case_path.to_owned(),
        argv: file.argv,
        cwd: file.cwd.unwrap_or_else(|| ".".to_owned()),
        cache_directory: file
            .env
            .cache_directory
            .unwrap_or_else(|| DEFAULT_CACHE_DIRECTORY.to_owned()),
        allow_local: file.env.allow_local,
        directory,
    })
}

/// Reads one `<unit>/<NN>-<function>.json`.
///
/// # Errors
///
/// When the file is no JSON or has another shape.
pub fn read_recorded_tool_file(
    path: &Utf8Path,
    text: &str,
) -> Result<RecordedToolFile, OracleError> {
    let file: RecordedFile = parse_case_text(path, text)?;

    Ok(RecordedToolFile {
        call: RecordedToolCall {
            function: file.function,
            args: file.args,
        },
        result: file.result,
        written: file.written,
    })
}

/// Reads one `cli/transcript.json`.
///
/// # Errors
///
/// When the file is no JSON or has another shape.
pub fn read_expected_transcript(
    path: &Utf8Path,
    text: &str,
) -> Result<ExpectedTranscript, OracleError> {
    parse_case_text(path, text)
}

fn read_case_file<Shape: DeserializeOwned>(path: &Utf8Path) -> Result<Shape, OracleError> {
    let text = std::fs::read_to_string(path).map_err(|source| OracleError::Read {
        path: path.to_owned(),
        source,
    })?;

    parse_case_text(path, &text)
}

fn parse_case_text<Shape: DeserializeOwned>(
    path: &Utf8Path,
    text: &str,
) -> Result<Shape, OracleError> {
    serde_json::from_str(text).map_err(|source| OracleError::Json {
        path: path.to_owned(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_name_reads_back_to_its_tool() {
        for tool in Tool::ALL {
            assert_eq!(Tool::from_name(tool.as_str()), Some(tool));
        }

        assert_eq!(Tool::from_name("compiler"), None);
    }

    #[test]
    fn a_cli_case_refuses_an_environment_variable_it_may_not_set() {
        let path = Utf8Path::new("cli.json");

        let refused = parse_case_text::<CliFile>(path, r#"{ "argv": [], "env": { "HOME": "/" } }"#);
        let accepted: CliFile = parse_case_text(
            path,
            r#"{ "argv": ["lint"], "env": { "SEAMPACT_ALLOW_LOCAL": "1" } }"#,
        )
        .unwrap();

        assert!(refused.is_err());
        assert_eq!(accepted.env.allow_local.as_deref(), Some("1"));
        assert_eq!(accepted.env.cache_directory, None);
    }

    #[test]
    fn a_merge_input_keeps_only_the_listed_operations_in_ir_order() {
        let ir = serde_json::json!({ "operations": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] });

        let kept = kept_operations(ir.clone(), Some(&["c".to_owned(), "a".to_owned()]));

        assert_eq!(
            kept,
            serde_json::json!({ "operations": [{ "id": "a" }, { "id": "c" }] })
        );
        assert_eq!(kept_operations(ir.clone(), None), ir);
    }

    #[test]
    fn a_recorded_call_without_written_files_reads_as_none_written() {
        let file = read_recorded_tool_file(
            Utf8Path::new("01-readAppConfig.json"),
            r#"{ "function": "readAppConfig", "args": ["<root>/seampact.config.yaml", "x"], "result": { "status": "read" } }"#,
        )
        .unwrap();

        assert_eq!(file.call.function, "readAppConfig");
        assert_eq!(file.call.args.len(), 2);
        assert!(file.written.is_empty());
    }
}
