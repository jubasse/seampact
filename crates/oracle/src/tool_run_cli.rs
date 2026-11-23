//! The CLI cases of a tool run: the command's transcript, and each call it recorded replayed on a
//! fresh run root.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_json::indented_json;
use serde_json::Value;

use crate::compare::{Mismatch, MismatchKind, value_mismatches};
use crate::expected::files_below;
use crate::generated_compare::{
    DOCUMENT_OWNER, GENERATED_MANIFEST_FILE, generated_file_mismatch, generated_file_pointer,
    holding_directory, is_token_compared, manifest_directory, manifest_v2_mismatches,
};
use crate::run_root::{ROOT_TOKEN, RunRoot, prepared_run_root};
use crate::tool_compare::{line_mismatches, unparsable, written_mismatches};
use crate::tool_discovery::{ToolCaseKind, ToolCasePath};
use crate::tool_outputs::{CaseOutcome, ComparedOutput, below, output_file};
use crate::tool_run::{ToolRun, read_json};
use crate::{
    CliCase, CliCommand, CliStep, ExpectedWrittenFile, OracleError, OutputKind, RecordedUnit,
    SubjectAnswer, Tool, ToolTally, Transcript, read_cli_case, read_expected_transcript,
    read_recorded_tool_file,
};

/// The recorded function whose result holds a bundle manifest.
const FETCH_BUNDLE_FUNCTION: &str = "fetchBundle";

/// The version of the Rust build, which its outputs may name.
const RUST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// What the Rust version is written as before a comparison.
const VERSION_TOKEN: &str = "<version>";

impl ToolRun<'_> {
    /// Runs the steps of a CLI case on one root, comparing each command with its transcript; the
    /// first command not ported, or failing, ends the case with that outcome.
    pub(crate) fn cli_case(&self, case: &str) -> Result<CaseOutcome, OracleError> {
        let cli_case = read_cli_case(self.repository_root, case)?;
        let root = run_root_of(&cli_case)?;
        let mut compared = Vec::new();
        let mut position = 0;

        for step in &cli_case.steps {
            let CliStep::Command(command) = step else {
                apply_file_step(&cli_case, step, root.path())?;

                continue;
            };

            position += 1;

            match self.command_case(&cli_case, command, position, root.path())? {
                CaseOutcome::Compared(outputs) => compared.extend(outputs),
                other => return Ok(other),
            }
        }

        Ok(CaseOutcome::Compared(compared))
    }

    /// Runs the steps before the command at `position` on `root`; `Some` outcome when one of
    /// those commands is not ported or fails.
    fn run_steps_before(
        &self,
        cli_case: &CliCase,
        position: usize,
        root: &Utf8Path,
    ) -> Result<Option<CaseOutcome>, OracleError> {
        let mut commands_run = 0;

        for step in &cli_case.steps {
            let CliStep::Command(command) = step else {
                apply_file_step(cli_case, step, root)?;

                continue;
            };

            commands_run += 1;

            if commands_run >= position {
                break;
            }

            match self.subject.cli(cli_case, command, root) {
                SubjectAnswer::Ported(_) => {}
                SubjectAnswer::NotPorted => return Ok(Some(CaseOutcome::NotPorted)),
                SubjectAnswer::InternalError { message } => {
                    return Ok(Some(CaseOutcome::InternalError(message)));
                }
            }
        }

        Ok(None)
    }

    fn command_case(
        &self,
        cli_case: &CliCase,
        command: &CliCommand,
        position: usize,
        root: &Utf8Path,
    ) -> Result<CaseOutcome, OracleError> {
        let transcript_file = cli_case.transcript_file(position);
        let transcript_path = self
            .expected_directory(&cli_case.path)
            .join(&transcript_file);
        let expected_text = read_text(&transcript_path)?;
        let expected = read_expected_transcript(&transcript_path, &expected_text)?;

        let transcript = match self.subject.cli(cli_case, command, root) {
            SubjectAnswer::Ported(transcript) => transcript,
            SubjectAnswer::NotPorted => return Ok(CaseOutcome::NotPorted),
            SubjectAnswer::InternalError { message } => {
                return Ok(CaseOutcome::InternalError(message));
            }
        };

        let root_text = root.as_str();
        let stdout = without_rust_version(&transcript.stdout.replace(root_text, ROOT_TOKEN));
        let stderr = without_rust_version(&transcript.stderr.replace(root_text, ROOT_TOKEN));
        let mut removed = transcript.removed.clone();

        removed.sort();

        let short_id_of = |package_name: &str| self.subject.target_short_id(package_name);
        let split = split_generated(&expected.written, &transcript.written, root, &short_id_of);

        let fields = [
            (
                OutputKind::CliExit,
                exit_mismatches(expected.exit, &transcript),
            ),
            (
                OutputKind::CliStdout,
                below("/stdout", line_mismatches(&expected.stdout, &stdout)),
            ),
            (
                OutputKind::CliStderr,
                below("/stderr", line_mismatches(&expected.stderr, &stderr)),
            ),
            (
                OutputKind::CliFiles,
                [
                    below(
                        "/written",
                        written_mismatches(&split.expected_rest, &split.actual_rest),
                    ),
                    below("/written", split.manifest_mismatches),
                    below(
                        "/removed",
                        value_mismatches(&string_list(&expected.removed), &string_list(&removed)),
                    ),
                ]
                .concat(),
            ),
            (OutputKind::Generated, split.generated_mismatches),
        ];

        let compared = fields
            .into_iter()
            .map(|(output, mismatches)| ComparedOutput {
                name: transcript_file.clone(),
                file: output_file(output),
                mismatches,
                expected_text: Some(expected_text.clone()),
                actual_text: None,
            })
            .collect();

        Ok(CaseOutcome::Compared(compared))
    }

    /// Replays the calls of the unit of `tally` recorded under each selected CLI case.
    pub(crate) fn run_recorded(
        &mut self,
        tally: &mut ToolTally,
        cases: &[ToolCasePath],
    ) -> Result<(), OracleError> {
        let unit = match tally.tool {
            Tool::CliConfig => RecordedUnit::CliConfig,
            Tool::EditorSchemas => RecordedUnit::EditorSchemas,
            Tool::BundleFetch => RecordedUnit::BundleFetch,
            Tool::Openapi
            | Tool::OpenapiMerge
            | Tool::Lint
            | Tool::DiffTable
            | Tool::Diff
            | Tool::Bundle
            | Tool::Cli => return Ok(()),
        };

        for case in cases {
            if case.kind != ToolCaseKind::Cli || !self.selects(&case.path) {
                continue;
            }

            let cli_case = read_cli_case(self.repository_root, &case.path)?;
            let mut names = Vec::new();

            files_below(
                &self.expected_directory(&case.path).join(unit.as_str()),
                unit.as_str(),
                &mut names,
            )?;
            names.sort();

            for name in names {
                let outcome = self.recorded_case(&cli_case, unit, &name)?;

                self.settle(tally, &case.path, outcome);
            }
        }

        Ok(())
    }

    fn recorded_case(
        &self,
        cli_case: &CliCase,
        unit: RecordedUnit,
        name: &str,
    ) -> Result<CaseOutcome, OracleError> {
        let path = self.expected_directory(&cli_case.path).join(name);
        let expected_text = read_text(&path)?;
        let recorded = read_recorded_tool_file(&path, &expected_text)?;
        let expected_file: Value = read_json(&path)?;
        let root = run_root_of(cli_case)?;

        if let Some(position) = recorded.step
            && let Some(outcome) = self.run_steps_before(cli_case, position, root.path())?
        {
            return Ok(outcome);
        }

        let answer = match self
            .subject
            .recorded_call(unit, &recorded.call, root.path())
        {
            SubjectAnswer::Ported(answer) => answer,
            SubjectAnswer::NotPorted => return Ok(CaseOutcome::NotPorted),
            SubjectAnswer::InternalError { message } => {
                return Ok(CaseOutcome::InternalError(message));
            }
        };

        let actual_text = indented_json(&answer.result).replace(root.path().as_str(), ROOT_TOKEN);
        let Ok(actual_result) = serde_json::from_str::<Value>(&actual_text) else {
            return Ok(CaseOutcome::InternalError(format!(
                "the result of {} is no JSON once the run root is replaced",
                recorded.call.function
            )));
        };

        let is_fetch = recorded.call.function == FETCH_BUNDLE_FUNCTION;
        let Some(expected_result) = expected_file.get("result").cloned() else {
            return Err(OracleError::Shape {
                path,
                problem: "a recorded call holds its result".to_owned(),
            });
        };
        let expected_result = without_manifest_compiler(expected_result, is_fetch);
        let actual_result = without_manifest_compiler(actual_result, is_fetch);
        let mismatches = [
            below(
                "/result",
                value_mismatches(&expected_result, &actual_result),
            ),
            below(
                "/written",
                written_mismatches(&recorded.written, &answer.written),
            ),
        ]
        .concat();

        Ok(CaseOutcome::Compared(vec![ComparedOutput {
            name: name.to_owned(),
            file: output_file(unit_output(unit)),
            mismatches,
            expected_text: Some(expected_text),
            actual_text: Some(actual_text),
        }]))
    }
}

const fn unit_output(unit: RecordedUnit) -> OutputKind {
    match unit {
        RecordedUnit::CliConfig => OutputKind::CliConfig,
        RecordedUnit::EditorSchemas => OutputKind::EditorSchemas,
        RecordedUnit::BundleFetch => OutputKind::BundleFetch,
    }
}

/// Applies a `write` or `remove` step under `root`; a path to remove that is absent, or a file
/// that cannot be written, is a case error.
fn apply_file_step(case: &CliCase, step: &CliStep, root: &Utf8Path) -> Result<(), OracleError> {
    let case_error = |problem: String| OracleError::RunRoot {
        case: case.path.clone(),
        problem,
    };

    match step {
        CliStep::Command(_) => Ok(()),
        CliStep::Write { write } => {
            for (path, text) in write {
                let file = root.join(path);

                if let Some(parent) = file.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| case_error(format!("cannot create {parent}: {error}")))?;
                }

                std::fs::write(&file, text)
                    .map_err(|error| case_error(format!("cannot write {file}: {error}")))?;
            }

            Ok(())
        }
        CliStep::Remove { remove } => {
            for path in remove {
                let target = root.join(path);
                let metadata = std::fs::symlink_metadata(&target).map_err(|error| {
                    case_error(format!("the step removes {path}, which is absent: {error}"))
                })?;
                let removed = if metadata.is_dir() {
                    std::fs::remove_dir_all(&target)
                } else {
                    std::fs::remove_file(&target)
                };

                removed.map_err(|error| case_error(format!("cannot remove {target}: {error}")))?;
            }

            Ok(())
        }
    }
}

/// The written files of one command split by how they compare: generated files as token streams,
/// manifests by their hashes, and the rest (documents of an `openapi` directory included) as every
/// written file.
struct GeneratedSplit {
    generated_mismatches: Vec<Mismatch>,
    manifest_mismatches: Vec<Mismatch>,
    expected_rest: IndexMap<String, ExpectedWrittenFile>,
    actual_rest: IndexMap<String, Vec<u8>>,
}

fn split_generated(
    expected: &IndexMap<String, ExpectedWrittenFile>,
    actual: &IndexMap<String, Vec<u8>>,
    root: &Utf8Path,
    short_id_of: &dyn Fn(&str) -> Option<String>,
) -> GeneratedSplit {
    let mut directories: Vec<&str> = expected
        .keys()
        .chain(actual.keys())
        .filter_map(|path| manifest_directory(path))
        .collect();

    directories.sort_unstable();
    directories.dedup();

    let mut split = GeneratedSplit {
        generated_mismatches: Vec::new(),
        manifest_mismatches: Vec::new(),
        expected_rest: IndexMap::new(),
        actual_rest: IndexMap::new(),
    };
    let mut paths: Vec<&String> = expected.keys().chain(actual.keys()).collect();

    paths.sort_unstable();
    paths.dedup();

    for path in paths {
        let expected_file = expected.get(path);
        let actual_bytes = actual.get(path);
        let directory = holding_directory(path, &directories);
        let is_document_directory = directory.is_some_and(|directory| {
            manifest_owner(expected, actual, directory).as_deref() == Some(DOCUMENT_OWNER)
        });

        if let Some(directory) = manifest_directory(path) {
            split.manifest_mismatches.extend(manifest_file_mismatches(
                path,
                expected_file,
                actual_bytes,
                &root.join(directory),
                &|relative| expected_bytes_below(expected, directory, relative),
            ));

            continue;
        }

        if directory.is_none() || is_document_directory || !is_token_compared(path) {
            if let Some(expected_file) = expected_file {
                split
                    .expected_rest
                    .insert(path.clone(), expected_file.clone());
            }

            if let Some(actual_bytes) = actual_bytes {
                split.actual_rest.insert(path.clone(), actual_bytes.clone());
            }

            continue;
        }

        split.generated_mismatches.extend(generated_mismatch(
            path,
            expected_file,
            actual_bytes,
            short_id_of,
        ));
    }

    split
}

/// The one mismatch of a generated file: present on one side only, not text, or its tokens.
fn generated_mismatch(
    path: &str,
    expected_file: Option<&ExpectedWrittenFile>,
    actual_bytes: Option<&Vec<u8>>,
    short_id_of: &dyn Fn(&str) -> Option<String>,
) -> Option<Mismatch> {
    let pointer = generated_file_pointer(path);

    let (Some(expected_file), Some(actual_bytes)) = (expected_file, actual_bytes) else {
        let kind = if expected_file.is_some() {
            MismatchKind::Removed
        } else {
            MismatchKind::Added
        };

        return Some(file_only_on_one_side(pointer, kind));
    };

    let (Some(expected_text), Ok(actual_text)) = (
        expected_file.text.as_deref(),
        std::str::from_utf8(actual_bytes),
    ) else {
        return Some(Mismatch {
            pointer: Some(pointer),
            ..unparsable()
        });
    };

    generated_file_mismatch(path, expected_text, actual_text, short_id_of)
}

/// The mismatches of a manifest written by one side or both.
fn manifest_file_mismatches(
    path: &str,
    expected_file: Option<&ExpectedWrittenFile>,
    actual_bytes: Option<&Vec<u8>>,
    directory: &Utf8Path,
    expected_bytes_of: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Vec<Mismatch> {
    let pointer = generated_file_pointer(path);

    let (Some(expected_file), Some(actual_bytes)) = (expected_file, actual_bytes) else {
        let kind = if expected_file.is_some() {
            MismatchKind::Removed
        } else {
            MismatchKind::Added
        };

        return vec![file_only_on_one_side(pointer, kind)];
    };

    let (Some(expected_text), Ok(actual_text)) = (
        expected_file.text.as_deref(),
        std::str::from_utf8(actual_bytes),
    ) else {
        return vec![Mismatch {
            pointer: Some(pointer),
            ..unparsable()
        }];
    };

    manifest_v2_mismatches(
        path,
        expected_text,
        actual_text,
        directory,
        expected_bytes_of,
    )
}

fn file_only_on_one_side(pointer: String, kind: MismatchKind) -> Mismatch {
    Mismatch {
        pointer: Some(pointer),
        kind,
        expected: None,
        actual: None,
    }
}

/// The owner a written manifest of `directory` names, the TypeScript one first.
fn manifest_owner(
    expected: &IndexMap<String, ExpectedWrittenFile>,
    actual: &IndexMap<String, Vec<u8>>,
    directory: &str,
) -> Option<String> {
    let manifest_path = path_below(directory, GENERATED_MANIFEST_FILE);
    let expected_text = expected
        .get(&manifest_path)
        .and_then(|file| file.text.clone());
    let actual_text = actual
        .get(&manifest_path)
        .and_then(|bytes| String::from_utf8(bytes.clone()).ok());

    [expected_text, actual_text]
        .into_iter()
        .flatten()
        .find_map(|text| {
            let manifest: Value = serde_json::from_str(&text).ok()?;

            manifest.get("owner")?.as_str().map(str::to_owned)
        })
}

fn expected_bytes_below(
    expected: &IndexMap<String, ExpectedWrittenFile>,
    directory: &str,
    relative: &str,
) -> Option<Vec<u8>> {
    expected
        .get(&path_below(directory, relative))
        .and_then(|file| file.text.clone())
        .map(String::into_bytes)
}

fn path_below(directory: &str, relative: &str) -> String {
    if directory.is_empty() {
        relative.to_owned()
    } else {
        format!("{directory}/{relative}")
    }
}

/// The Rust version in a stream written as `<version>`, as the run root is written `<root>`.
fn without_rust_version(text: &str) -> String {
    text.replace(
        &format!("seampact {RUST_VERSION}"),
        &format!("seampact {VERSION_TOKEN}"),
    )
}

fn run_root_of(case: &CliCase) -> Result<RunRoot, OracleError> {
    prepared_run_root(case).map_err(|problem| OracleError::RunRoot {
        case: case.path.clone(),
        problem,
    })
}

fn exit_mismatches(expected_exit: i32, transcript: &Transcript) -> Vec<Mismatch> {
    if expected_exit == transcript.exit {
        return Vec::new();
    }

    vec![Mismatch {
        pointer: Some("/exit".to_owned()),
        kind: MismatchKind::Value,
        expected: Some(Value::from(expected_exit)),
        actual: Some(Value::from(transcript.exit)),
    }]
}

fn string_list(paths: &[String]) -> Value {
    Value::Array(paths.iter().cloned().map(Value::String).collect())
}

/// The fetch result with `/manifest/compiler` set to `null`, as a bundle manifest is compared: the
/// TypeScript and the Rust builds name different compilers.
fn without_manifest_compiler(mut result: Value, is_fetch: bool) -> Value {
    if !is_fetch {
        return result;
    }

    if let Some(Value::Object(manifest)) = result.get_mut("manifest")
        && manifest.contains_key("compiler")
    {
        manifest.insert("compiler".to_owned(), Value::Null);
    }

    result
}

fn read_text(path: &Utf8Path) -> Result<String, OracleError> {
    std::fs::read_to_string(path).map_err(|source| OracleError::Read {
        path: path.to_owned(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fetch_result_compares_its_manifest_without_the_compiler() {
        let result = serde_json::json!({ "ok": true, "manifest": { "compiler": { "name": "x" }, "apis": [] } });

        let normalized = without_manifest_compiler(result.clone(), true);

        assert_eq!(normalized["manifest"]["compiler"], Value::Null);
        assert_eq!(without_manifest_compiler(result.clone(), false), result);
    }
}
