//! One tool run: every selected tool case run by a [`ToolSubject`] and compared with its expected
//! files under the intended differences, one tally per tool.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_json::JsonValue;

use crate::compare::mismatch_context;
use crate::differences::{DIFFERENCES_FILE, read_differences};
use crate::expected::files_below;
use crate::matcher::{ComparedFile, DifferenceLedger, MatchOutcome};
use crate::tool_discovery::{ToolCaseKind, ToolCasePath, discover_tool_cases};
use crate::tool_outputs::{
    CaseOutcome, NamedOutput, OutputFormat, api_output_file, compare_outputs, expected_output,
    json_output, output_file,
};
use crate::{
    BundleAnswer, EXPECTED_DIRECTORY, FIXTURES_DIRECTORY, FirstFailure, Fixture, FixtureGlob,
    OpenApiAnswer, OracleError, OutputKind, SubjectAnswer, Tool, ToolSubject, ToolTally,
    ToolVerdict, discover_fixtures, read_bundle_case, read_diff_case, read_merge_case,
};

/// What a tool run compares.
#[derive(Debug, Clone, Default)]
pub struct ToolSelection {
    /// The one tool run, every tool when absent.
    pub tool: Option<Tool>,
    /// The cases, every one when absent; the global `diff-table` case runs only without a glob.
    pub case_glob: Option<FixtureGlob>,
}

/// The options file of a fixture or converted OpenAPI case.
const OPENAPI_OPTIONS_FILE: &str = "openapi.options.json";

/// The extension of an expected OpenAPI document.
const YAML_EXTENSION: &str = "yaml";

/// The IR of a converted OpenAPI case.
const CONVERTED_IR_FILE: &str = "ir.json";

/// The expected file of the global diff table case, under `fixtures/expected/`.
const DIFF_TABLE_FILE: &str = "diff-table.json";

/// How the verdict and `differences.yaml` name the global diff table case, which has no path.
const DIFF_TABLE_CASE: &str = "diff-table";

/// Runs every selected tool case of the repository at `repository_root` with `subject`.
///
/// # Errors
///
/// When a case file or an expected file cannot be read or has another shape, or a CLI case's run
/// root cannot be prepared.
pub fn run_tools(
    repository_root: &Utf8Path,
    selection: &ToolSelection,
    subject: &dyn ToolSubject,
) -> Result<ToolVerdict, OracleError> {
    let differences = read_differences(repository_root, &repository_root.join(DIFFERENCES_FILE))?;
    let cases = discover_tool_cases(repository_root)?;
    let mut run = ToolRun {
        repository_root,
        case_glob: selection.case_glob.as_ref(),
        subject,
        ledger: DifferenceLedger::new(differences.differences),
        verdict: ToolVerdict::default(),
    };

    for tool in Tool::ALL {
        if selection.tool.is_some_and(|selected| selected != tool) {
            continue;
        }

        let mut tally = ToolTally::new(tool);

        run.run_tool(&mut tally, &cases)?;
        run.verdict.tallies.push(tally);
    }

    let stale: Vec<String> = run
        .ledger
        .stale_ids()
        .into_iter()
        .map(|id| format!("difference {id} matched no mismatch: delete it from {DIFFERENCES_FILE}"))
        .collect();

    run.verdict.problems.extend(stale);

    Ok(run.verdict)
}

/// The state of one tool run.
pub(crate) struct ToolRun<'run> {
    pub(crate) repository_root: &'run Utf8Path,
    pub(crate) case_glob: Option<&'run FixtureGlob>,
    pub(crate) subject: &'run dyn ToolSubject,
    ledger: DifferenceLedger,
    verdict: ToolVerdict,
}

impl ToolRun<'_> {
    fn run_tool(
        &mut self,
        tally: &mut ToolTally,
        cases: &[ToolCasePath],
    ) -> Result<(), OracleError> {
        match tally.tool {
            Tool::Openapi => self.run_openapi(tally, cases),
            Tool::OpenapiMerge => {
                self.run_cases(tally, cases, ToolCaseKind::Merge, Self::merge_case)
            }
            Tool::Lint => self.run_lint(tally),
            Tool::DiffTable => self.run_diff_table(tally),
            Tool::Diff => self.run_cases(tally, cases, ToolCaseKind::Diff, Self::diff_case),
            Tool::Bundle => self.run_cases(tally, cases, ToolCaseKind::Bundle, Self::bundle_case),
            Tool::CliConfig | Tool::EditorSchemas | Tool::BundleFetch => {
                self.run_recorded(tally, cases)
            }
            Tool::Cli => self.run_cases(tally, cases, ToolCaseKind::Cli, Self::cli_case),
        }
    }

    /// Whether the case at `path` is selected.
    pub(crate) fn selects(&self, path: &str) -> bool {
        self.case_glob.is_none_or(|glob| glob.matches(path))
    }

    /// The expected directory of the case at `path`.
    pub(crate) fn expected_directory(&self, path: &str) -> Utf8PathBuf {
        self.repository_root.join(EXPECTED_DIRECTORY).join(path)
    }

    fn run_cases(
        &mut self,
        tally: &mut ToolTally,
        cases: &[ToolCasePath],
        kind: ToolCaseKind,
        run_case: fn(&Self, &str) -> Result<CaseOutcome, OracleError>,
    ) -> Result<(), OracleError> {
        for case in cases {
            if case.kind != kind || !self.selects(&case.path) {
                continue;
            }

            let outcome = run_case(self, &case.path)?;

            self.settle(tally, &case.path, outcome);
        }

        Ok(())
    }

    /// Counts one case and takes its mismatches into the ledger; the first failing one is named.
    pub(crate) fn settle(&mut self, tally: &mut ToolTally, case: &str, outcome: CaseOutcome) {
        tally.cases += 1;

        let outputs = match outcome {
            CaseOutcome::NotPorted => {
                tally.not_ported += 1;

                return;
            }
            CaseOutcome::InternalError(message) => {
                tally.differing += 1;
                self.verdict.problems.push(format!(
                    "{} case {case}: internal error: {message}",
                    tally.tool.as_str()
                ));

                return;
            }
            CaseOutcome::Compared(outputs) => outputs,
        };

        let mut has_failure = false;

        for output in &outputs {
            let compared = ComparedFile {
                fixture: case,
                file: &output.file,
            };

            self.ledger.record_compared(compared);

            for mismatch in &output.mismatches {
                let match_outcome = self.ledger.take(compared, mismatch);

                if match_outcome == MatchOutcome::Accepted {
                    continue;
                }

                has_failure = true;

                if self.verdict.first_failure.is_some() {
                    continue;
                }

                let (expected_context, actual_context) = mismatch_context(
                    output.expected_text.as_deref(),
                    output.actual_text.as_deref(),
                    mismatch,
                );
                let summary = match &match_outcome {
                    MatchOutcome::Ambiguous(entry_ids) => format!(
                        "{}; matched by more than one difference: {}",
                        mismatch.summary(),
                        entry_ids.join(", ")
                    ),
                    MatchOutcome::Accepted | MatchOutcome::Unmatched => mismatch.summary(),
                };

                self.verdict.first_failure = Some(FirstFailure {
                    fixture: case.to_owned(),
                    file: output.name.clone(),
                    pointer: mismatch.pointer.clone(),
                    summary,
                    expected_context,
                    actual_context,
                });
            }
        }

        if has_failure {
            tally.differing += 1;
        } else {
            tally.matching += 1;
        }
    }

    fn run_openapi(
        &mut self,
        tally: &mut ToolTally,
        cases: &[ToolCasePath],
    ) -> Result<(), OracleError> {
        for fixture in discover_fixtures(self.repository_root)? {
            if !self.selects(&fixture.path) {
                continue;
            }

            let options = read_optional_json(&fixture.directory.join(OPENAPI_OPTIONS_FILE))?;

            for (api, ir) in self.expected_irs(&fixture)? {
                let outcome = self.openapi_case(&fixture.path, &api, &ir, options.as_ref())?;

                self.settle(tally, &fixture.path, outcome);
            }
        }

        for case in cases {
            if case.kind != ToolCaseKind::Openapi || !self.selects(&case.path) {
                continue;
            }

            let directory = self
                .repository_root
                .join(FIXTURES_DIRECTORY)
                .join(&case.path);
            let ir_path = directory.join(CONVERTED_IR_FILE);
            let ir = read_optional_json(&ir_path)?.ok_or_else(|| OracleError::Shape {
                path: ir_path.clone(),
                problem: "a converted OpenAPI case holds its IR".to_owned(),
            })?;
            let options = read_optional_json(&directory.join(OPENAPI_OPTIONS_FILE))?;
            let api = self.converted_api_name(&case.path, &ir, &ir_path)?;
            let outcome = self.openapi_case(&case.path, &api, &ir, options.as_ref())?;

            self.settle(tally, &case.path, outcome);
        }

        Ok(())
    }

    /// Each api of `fixture` with an expected IR, and that IR, in api name order.
    fn expected_irs(&self, fixture: &Fixture) -> Result<Vec<(String, JsonValue)>, OracleError> {
        let mut names = Vec::new();

        files_below(
            &self.expected_directory(&fixture.path).join("ir"),
            "ir",
            &mut names,
        )?;
        names.sort();

        names
            .iter()
            .filter_map(|name| {
                let api = name.strip_prefix("ir/")?.strip_suffix(".json")?;

                Some((api, name))
            })
            .map(|(api, name)| {
                let ir = read_json(&self.expected_directory(&fixture.path).join(name))?;

                Ok((api.to_owned(), ir))
            })
            .collect()
    }

    /// The api a converted case's expected files name: the one entry of its `openapi/`, else the
    /// IR's `api.id`.
    fn converted_api_name(
        &self,
        case: &str,
        ir: &JsonValue,
        ir_path: &Utf8Path,
    ) -> Result<String, OracleError> {
        let mut names = Vec::new();

        files_below(
            &self.expected_directory(case).join("openapi"),
            "openapi",
            &mut names,
        )?;

        let mut apis: Vec<&str> = names
            .iter()
            .filter_map(|name| {
                let below = name.strip_prefix("openapi/")?;

                below
                    .strip_suffix(".refusals.json")
                    .or_else(|| below.split_once('/').map(|(api, _)| api))
            })
            .collect();

        apis.dedup();

        if let [api] = apis.as_slice() {
            return Ok((*api).to_owned());
        }

        api_id(ir)
            .map(str::to_owned)
            .ok_or_else(|| OracleError::Shape {
                path: ir_path.to_owned(),
                problem: "the IR names no api id and the expected files no single api".to_owned(),
            })
    }

    fn openapi_case(
        &self,
        case: &str,
        api: &str,
        ir: &JsonValue,
        options: Option<&JsonValue>,
    ) -> Result<CaseOutcome, OracleError> {
        let directory = self.expected_directory(case);
        let refusals_name = format!("openapi/{api}.refusals.json");
        let mut expected = Vec::new();
        let mut document_names = Vec::new();

        files_below(
            &directory.join("openapi").join(api),
            &format!("openapi/{api}"),
            &mut document_names,
        )?;
        document_names.sort();

        for name in document_names
            .iter()
            .filter(|name| Utf8Path::new(name.as_str()).extension() == Some(YAML_EXTENSION))
        {
            expected.extend(expected_output(
                &directory,
                name,
                api_output_file(OutputKind::Openapi, api),
                OutputFormat::Yaml,
            )?);
        }

        expected.extend(expected_output(
            &directory,
            &refusals_name,
            api_output_file(OutputKind::OpenapiRefusals, api),
            OutputFormat::Json,
        )?);

        let actual_of = |answer: OpenApiAnswer| match answer {
            OpenApiAnswer::Documents(documents) => documents
                .into_iter()
                .map(|(document, text)| NamedOutput {
                    name: format!("openapi/{api}/{document}.yaml"),
                    file: api_output_file(OutputKind::Openapi, api),
                    format: OutputFormat::Yaml,
                    text,
                })
                .collect(),
            OpenApiAnswer::Refusals(refusals) => vec![json_output(
                refusals_name.clone(),
                api_output_file(OutputKind::OpenapiRefusals, api),
                &refusals,
            )],
        };

        compared_outcome(
            &directory,
            self.subject.openapi(ir, options),
            expected,
            actual_of,
        )
    }

    fn merge_case(&self, case: &str) -> Result<CaseOutcome, OracleError> {
        let merge_case = read_merge_case(self.repository_root, case)?;
        let directory = self.expected_directory(case);
        let merged_name = "openapi-merge/merged.yaml";
        let refusals_name = "openapi-merge/refusals.json";
        let mut expected = Vec::new();

        expected.extend(expected_output(
            &directory,
            merged_name,
            output_file(OutputKind::Openapi),
            OutputFormat::Yaml,
        )?);
        expected.extend(expected_output(
            &directory,
            refusals_name,
            output_file(OutputKind::OpenapiRefusals),
            OutputFormat::Json,
        )?);

        let actual_of = |answer: OpenApiAnswer| match answer {
            OpenApiAnswer::Documents(documents) => documents
                .into_iter()
                .map(|(_, text)| NamedOutput {
                    name: merged_name.to_owned(),
                    file: output_file(OutputKind::Openapi),
                    format: OutputFormat::Yaml,
                    text,
                })
                .collect(),
            OpenApiAnswer::Refusals(refusals) => vec![json_output(
                refusals_name.to_owned(),
                output_file(OutputKind::OpenapiRefusals),
                &refusals,
            )],
        };

        compared_outcome(
            &directory,
            self.subject.openapi_merge(&merge_case),
            expected,
            actual_of,
        )
    }

    fn run_lint(&mut self, tally: &mut ToolTally) -> Result<(), OracleError> {
        for fixture in discover_fixtures(self.repository_root)? {
            if !self.selects(&fixture.path) {
                continue;
            }

            for (api, _) in self.expected_irs(&fixture)? {
                let directory = self.expected_directory(&fixture.path);
                let name = format!("lint/{api}.json");
                let file = api_output_file(OutputKind::Lint, &api);
                let expected: Vec<NamedOutput> =
                    expected_output(&directory, &name, file.clone(), OutputFormat::Json)?
                        .into_iter()
                        .collect();

                // An api the linter reports nothing for has no file.
                let actual_of = |diagnostics: JsonValue| {
                    let is_empty =
                        matches!(&diagnostics, JsonValue::Array(items) if items.is_empty());

                    if is_empty {
                        return Vec::new();
                    }

                    vec![json_output(name.clone(), file.clone(), &diagnostics)]
                };
                let outcome = compared_outcome(
                    &directory,
                    self.subject.lint(&fixture, &api),
                    expected,
                    actual_of,
                )?;

                self.settle(tally, &fixture.path, outcome);
            }
        }

        Ok(())
    }

    fn run_diff_table(&mut self, tally: &mut ToolTally) -> Result<(), OracleError> {
        if self.case_glob.is_some() {
            return Ok(());
        }

        let directory = self.repository_root.join(EXPECTED_DIRECTORY);
        let file = output_file(OutputKind::DiffTable);
        let expected: Vec<NamedOutput> = expected_output(
            &directory,
            DIFF_TABLE_FILE,
            file.clone(),
            OutputFormat::Json,
        )?
        .into_iter()
        .collect();
        let actual_of = |table: JsonValue| {
            vec![json_output(
                DIFF_TABLE_FILE.to_owned(),
                file.clone(),
                &table,
            )]
        };
        let outcome = compared_outcome(&directory, self.subject.diff_table(), expected, actual_of)?;

        self.settle(tally, DIFF_TABLE_CASE, outcome);

        Ok(())
    }

    fn diff_case(&self, case: &str) -> Result<CaseOutcome, OracleError> {
        let diff_case = read_diff_case(self.repository_root, case)?;
        let directory = self.expected_directory(case);
        let result_file = output_file(OutputKind::DiffResult);
        let report_file = output_file(OutputKind::DiffReport);
        let mut expected = Vec::new();

        expected.extend(expected_output(
            &directory,
            "diff/result.json",
            result_file.clone(),
            OutputFormat::Json,
        )?);
        expected.extend(expected_output(
            &directory,
            "diff/report.txt",
            report_file.clone(),
            OutputFormat::Lines,
        )?);

        let actual_of = |answer: crate::DiffAnswer| {
            vec![
                json_output(
                    "diff/result.json".to_owned(),
                    result_file.clone(),
                    &answer.result,
                ),
                NamedOutput {
                    name: "diff/report.txt".to_owned(),
                    file: report_file.clone(),
                    format: OutputFormat::Lines,
                    text: answer.report,
                },
            ]
        };

        compared_outcome(
            &directory,
            self.subject.diff(&diff_case),
            expected,
            actual_of,
        )
    }

    fn bundle_case(&self, case: &str) -> Result<CaseOutcome, OracleError> {
        let bundle_case = read_bundle_case(self.repository_root, case)?;
        let directory = self.expected_directory(case);
        let mut expected = Vec::new();

        for (name, output, format) in BUNDLE_OUTPUTS {
            expected.extend(expected_output(
                &directory,
                name,
                output_file(output),
                format,
            )?);
        }

        let actual_of = |answer: BundleAnswer| match answer {
            BundleAnswer::Built {
                files,
                manifest,
                integrity,
                ustar,
            } => vec![
                json_output(
                    "bundle/files.json".to_owned(),
                    output_file(OutputKind::BundleFiles),
                    &files,
                ),
                NamedOutput {
                    name: "bundle/manifest.json".to_owned(),
                    file: output_file(OutputKind::BundleManifest),
                    format: OutputFormat::Manifest,
                    text: manifest,
                },
                NamedOutput {
                    name: "bundle/integrity.txt".to_owned(),
                    file: output_file(OutputKind::BundleIntegrity),
                    format: OutputFormat::Lines,
                    text: format!("{integrity}\n"),
                },
                json_output(
                    "bundle/ustar.json".to_owned(),
                    output_file(OutputKind::BundleUstar),
                    &ustar,
                ),
            ],
            BundleAnswer::Refused(refusals) => vec![json_output(
                "bundle/refusals.json".to_owned(),
                output_file(OutputKind::BundleRefusals),
                &refusals,
            )],
        };

        compared_outcome(
            &directory,
            self.subject.bundle(&bundle_case),
            expected,
            actual_of,
        )
    }
}

/// The expected files of a bundle case, each with its output and format.
const BUNDLE_OUTPUTS: [(&str, OutputKind, OutputFormat); 5] = [
    (
        "bundle/files.json",
        OutputKind::BundleFiles,
        OutputFormat::Json,
    ),
    (
        "bundle/manifest.json",
        OutputKind::BundleManifest,
        OutputFormat::Manifest,
    ),
    (
        "bundle/integrity.txt",
        OutputKind::BundleIntegrity,
        OutputFormat::Lines,
    ),
    (
        "bundle/ustar.json",
        OutputKind::BundleUstar,
        OutputFormat::Json,
    ),
    (
        "bundle/refusals.json",
        OutputKind::BundleRefusals,
        OutputFormat::Json,
    ),
];

/// The outcome of an answer: not ported, an internal error, or its files compared with
/// `expected`.
pub(crate) fn compared_outcome<Output>(
    expected_directory: &Utf8Path,
    answer: SubjectAnswer<Output>,
    expected: Vec<NamedOutput>,
    actual_of: impl FnOnce(Output) -> Vec<NamedOutput>,
) -> Result<CaseOutcome, OracleError> {
    match answer {
        SubjectAnswer::NotPorted => Ok(CaseOutcome::NotPorted),
        SubjectAnswer::InternalError { message } => Ok(CaseOutcome::InternalError(message)),
        SubjectAnswer::Ported(output) => Ok(CaseOutcome::Compared(compare_outputs(
            expected_directory,
            expected,
            actual_of(output),
        )?)),
    }
}

/// The JSON file at `path`, `None` when absent.
fn read_optional_json(path: &Utf8Path) -> Result<Option<JsonValue>, OracleError> {
    if !path.is_file() {
        return Ok(None);
    }

    read_json(path).map(Some)
}

/// The JSON file at `path`.
pub(crate) fn read_json<Shape: serde::de::DeserializeOwned>(
    path: &Utf8Path,
) -> Result<Shape, OracleError> {
    let text = std::fs::read_to_string(path).map_err(|source| OracleError::Read {
        path: path.to_owned(),
        source,
    })?;

    serde_json::from_str(&text).map_err(|source| OracleError::Json {
        path: path.to_owned(),
        source,
    })
}

/// The `api.id` of an IR.
fn api_id(ir: &JsonValue) -> Option<&str> {
    let JsonValue::Object(members) = ir else {
        return None;
    };

    let Some(JsonValue::Object(api)) = members.get("api") else {
        return None;
    };

    match api.get("id") {
        Some(JsonValue::String(id)) => Some(id),
        _ => None,
    }
}
