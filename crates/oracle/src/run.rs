//! One oracle run: every selected fixture compiled by the subject and compared with its expected
//! files under the intended differences, then the whole-tree and rule-id checks.

use std::collections::HashSet;

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_json::{JsonValue, indented_json};
use serde_json::Value;

use crate::compare::{
    Mismatch, MismatchKind, mismatch_context, only_in_one, text_beyond_accepted, text_mismatches,
};
use crate::differences::{DIFFERENCES_FILE, read_differences};
use crate::expected::{
    DIAGNOSTICS_FILE, ExpectedFiles, expected_fixture_paths, read_expected_files,
};
use crate::fixtures::{discover_fixtures, read_excluded};
use crate::matcher::{ComparedFile, DifferenceLedger, MatchOutcome};
use crate::raw_text::{AcceptedPointers, identical_outside_accepted};
use crate::rule_ids::check_rule_ids;
use crate::verdict::{FirstFailure, Verdict};
use crate::{
    ApiDeltas, ExcludedFixtures, ExpectedDelta, Fixture, FixtureGlob, HalfInput, OracleError,
    OracleSubject, OutputFile, SubjectAnswer,
};

/// What a run compares.
#[derive(Debug, Clone, Default)]
pub struct Selection {
    /// The fixtures, every one when absent.
    pub fixture_glob: Option<FixtureGlob>,
    /// The pass half compared alone, every output when absent.
    pub half: Option<String>,
}

impl Selection {
    fn is_whole_run(&self) -> bool {
        self.fixture_glob.is_none() && self.half.is_none()
    }
}

/// The halves directory of a fixture's expected files.
const HALVES_PREFIX: &str = "halves/";

/// Runs the oracle on the repository at `repository_root` with `subject` as the compiler.
///
/// # Errors
///
/// A usage error when the glob matches no fixture or no selected fixture has the half; otherwise
/// when a repository file cannot be read or is invalid.
pub fn run_oracle(
    repository_root: &Utf8Path,
    selection: &Selection,
    subject: &dyn OracleSubject,
) -> Result<Verdict, OracleError> {
    let excluded = read_excluded(repository_root)?;
    let all_fixtures = discover_fixtures(repository_root)?;
    let selected_fixtures = selected_fixtures(&all_fixtures, &excluded, selection)?;
    let differences = read_differences(repository_root, &repository_root.join(DIFFERENCES_FILE))?;

    let mut run = Run {
        repository_root,
        selection,
        subject,
        excluded: &excluded,
        ledger: DifferenceLedger::new(differences.differences),
        verdict: Verdict::default(),
    };

    let expected_by_fixture = expected_files_of(repository_root, &selected_fixtures)?;

    refuse_unknown_half(selection, &expected_by_fixture)?;

    for (fixture, expected_files) in selected_fixtures.iter().zip(&expected_by_fixture) {
        run.compare_fixture(fixture, expected_files)?;
    }

    run.verdict
        .problems
        .extend(run.ledger.stale_ids().into_iter().map(|id| {
            format!("difference {id} matched no mismatch: delete it from {DIFFERENCES_FILE}")
        }));

    if selection.is_whole_run() {
        run.verdict
            .problems
            .extend(tree_problems(repository_root, &all_fixtures, &excluded)?);
    }

    let rule_ids = check_rule_ids(repository_root, &subject.rule_id_registry())?;

    run.verdict.rule_ids = Some(rule_ids);

    Ok(run.verdict)
}

fn selected_fixtures(
    all_fixtures: &[Fixture],
    excluded: &ExcludedFixtures,
    selection: &Selection,
) -> Result<Vec<Fixture>, OracleError> {
    let selected: Vec<Fixture> = all_fixtures
        .iter()
        .filter(|fixture| !excluded.fixtures.contains_key(&fixture.path))
        .filter(|fixture| {
            selection
                .fixture_glob
                .as_ref()
                .is_none_or(|glob| glob.matches(&fixture.path))
        })
        .cloned()
        .collect();

    if selected.is_empty() {
        return Err(OracleError::Usage {
            problem: "the glob matches no fixture".to_owned(),
        });
    }

    Ok(selected)
}

fn expected_files_of(
    repository_root: &Utf8Path,
    fixtures: &[Fixture],
) -> Result<Vec<ExpectedFiles>, OracleError> {
    fixtures
        .iter()
        .map(|fixture| read_expected_files(repository_root, fixture))
        .collect()
}

fn refuse_unknown_half(
    selection: &Selection,
    expected_by_fixture: &[ExpectedFiles],
) -> Result<(), OracleError> {
    let Some(half) = &selection.half else {
        return Ok(());
    };

    let has_half = expected_by_fixture
        .iter()
        .flat_map(IndexMap::keys)
        .filter_map(|name| OutputFile::of(name))
        .any(|file| file.half.as_ref() == Some(half));

    if has_half {
        return Ok(());
    }

    Err(OracleError::Usage {
        problem: format!("no selected fixture has an expected half {half}"),
    })
}

/// The whole-tree problems: expected outputs of no compiled fixture, `excluded.json` keys naming
/// no fixture.
fn tree_problems(
    repository_root: &Utf8Path,
    all_fixtures: &[Fixture],
    excluded: &ExcludedFixtures,
) -> Result<Vec<String>, OracleError> {
    let known_paths: HashSet<&str> = all_fixtures
        .iter()
        .map(|fixture| fixture.path.as_str())
        .collect();

    let mut problems: Vec<String> = expected_fixture_paths(repository_root)?
        .into_iter()
        .filter(|path| !known_paths.contains(path.as_str()) || excluded.fixtures.contains_key(path))
        .map(|path| format!("expected/{path} belongs to no compiled fixture: delete it"))
        .collect();

    for (list_name, reasons) in [
        ("fixtures", &excluded.fixtures),
        ("halves", &excluded.halves),
    ] {
        problems.extend(
            reasons
                .keys()
                .filter(|path| !known_paths.contains(path.as_str()))
                .map(|path| format!("excluded.json {list_name}: '{path}' names no fixture")),
        );
    }

    Ok(problems)
}

/// The expected deltas of one api in run order, and the file name of each.
#[derive(Debug, Default)]
struct NamedDeltas {
    names: Vec<String>,
    deltas: Vec<ExpectedDelta>,
}

impl NamedDeltas {
    fn push(&mut self, name: String, delta: ExpectedDelta) {
        self.names.push(name);
        self.deltas.push(delta);
    }

    fn iter(&self) -> impl Iterator<Item = (&String, &ExpectedDelta)> {
        self.names.iter().zip(&self.deltas)
    }

    fn get(&self, range: std::ops::RangeTo<usize>) -> Option<&[ExpectedDelta]> {
        self.deltas.get(range)
    }
}

/// The state of one run.
struct Run<'run> {
    repository_root: &'run Utf8Path,
    selection: &'run Selection,
    subject: &'run dyn OracleSubject,
    excluded: &'run ExcludedFixtures,
    ledger: DifferenceLedger,
    verdict: Verdict,
}

/// What comparing one fixture's files found.
#[derive(Debug, Default)]
struct FixtureTally {
    compared_files: usize,
    failing_files: usize,
}

impl Run<'_> {
    fn compare_fixture(
        &mut self,
        fixture: &Fixture,
        expected_files: &ExpectedFiles,
    ) -> Result<(), OracleError> {
        let mut tally = FixtureTally::default();

        if self.selection.half.is_none() {
            self.compare_compilation(fixture, expected_files, &mut tally)?;
        }

        if !self.excluded.halves.contains_key(&fixture.path) {
            self.compare_halves(fixture, expected_files, &mut tally)?;
        }

        self.verdict.fixtures += 1;

        if tally.compared_files == 0 {
            self.verdict.not_ported += 1;
        } else if tally.failing_files == 0 {
            self.verdict.matching += 1;
        } else {
            self.verdict.differing += 1;
        }

        Ok(())
    }

    fn compare_compilation(
        &mut self,
        fixture: &Fixture,
        expected_files: &ExpectedFiles,
        tally: &mut FixtureTally,
    ) -> Result<(), OracleError> {
        let SubjectAnswer::Ported(compilation) = self.subject.compile(fixture) else {
            return Ok(());
        };

        let mut actual_files: IndexMap<String, String> = IndexMap::new();

        actual_files.insert(
            DIAGNOSTICS_FILE.to_owned(),
            indented_json(&compilation.diagnostics),
        );

        for compiled_api in compilation.apis {
            if let Some(ir_text) = compiled_api.ir {
                actual_files.insert(format!("ir/{}.json", compiled_api.api), ir_text);
            }

            if let Some(source_map_text) = compiled_api.source_map {
                actual_files.insert(
                    format!("source-map/{}.json", compiled_api.api),
                    source_map_text,
                );
            }
        }

        let compiled_names = expected_files
            .keys()
            .filter(|name| !name.starts_with(HALVES_PREFIX))
            .chain(actual_files.keys())
            .cloned()
            .collect::<indexmap::IndexSet<String>>();

        let mut names: Vec<String> = compiled_names.into_iter().collect();

        names.sort_by(|left, right| seampact_js::cmp_utf16(left, right));

        for name in names {
            let expected_text = expected_files.get(&name).map(String::as_str);
            let actual_text = actual_files.get(&name).map(String::as_str);

            self.compare_file(fixture, &name, expected_text, actual_text, tally)?;
        }

        Ok(())
    }

    fn compare_halves(
        &mut self,
        fixture: &Fixture,
        expected_files: &ExpectedFiles,
        tally: &mut FixtureTally,
    ) -> Result<(), OracleError> {
        let deltas_by_api = self.expected_deltas_by_api(fixture, expected_files)?;

        for (api, deltas) in &deltas_by_api {
            let other_apis: Vec<ApiDeltas<'_>> = deltas_by_api
                .iter()
                .filter(|(other_api, _)| *other_api != api)
                .map(|(other_api, other_deltas)| ApiDeltas {
                    api: other_api,
                    deltas: &other_deltas.deltas,
                })
                .collect();

            for (position, (name, expected)) in deltas.iter().enumerate() {
                let is_selected = self
                    .selection
                    .half
                    .as_ref()
                    .is_none_or(|selected| *selected == expected.half);

                if !is_selected {
                    continue;
                }

                let input = HalfInput {
                    deltas_before: deltas.get(..position).unwrap_or_default(),
                    other_apis: other_apis.clone(),
                };

                let SubjectAnswer::Ported(delta) =
                    self.subject.run_half(fixture, api, &expected.half, &input)
                else {
                    continue;
                };

                let expected_text = expected_files.get(name).map(String::as_str);
                let actual_text = indented_json(&delta);

                self.compare_file(fixture, name, expected_text, Some(&actual_text), tally)?;
            }
        }

        Ok(())
    }

    /// The expected deltas of each api with expected halves, in run order, keyed by api in file
    /// name order; each delta beside its file name.
    fn expected_deltas_by_api(
        &self,
        fixture: &Fixture,
        expected_files: &ExpectedFiles,
    ) -> Result<IndexMap<String, NamedDeltas>, OracleError> {
        let mut deltas_by_api: IndexMap<String, NamedDeltas> = IndexMap::new();

        for (name, expected_text) in expected_files {
            let Some(OutputFile {
                api: Some(api),
                half: Some(half),
                ..
            }) = OutputFile::of(name)
            else {
                continue;
            };

            let delta: JsonValue =
                serde_json::from_str(expected_text).map_err(|source| OracleError::Json {
                    path: self.expected_path(fixture, name),
                    source,
                })?;

            deltas_by_api
                .entry(api)
                .or_default()
                .push(name.clone(), ExpectedDelta { half, delta });
        }

        Ok(deltas_by_api)
    }

    fn expected_path(&self, fixture: &Fixture, name: &str) -> camino::Utf8PathBuf {
        crate::expected::expected_directory_of(self.repository_root, fixture).join(name)
    }

    fn compare_file(
        &mut self,
        fixture: &Fixture,
        name: &str,
        expected_text: Option<&str>,
        actual_text: Option<&str>,
        tally: &mut FixtureTally,
    ) -> Result<(), OracleError> {
        let mismatches = self.file_mismatches(fixture, name, expected_text, actual_text)?;
        let output_file = OutputFile::of(name);

        tally.compared_files += 1;

        if let Some(file) = &output_file {
            self.ledger.record_compared(ComparedFile {
                fixture: &fixture.path,
                file,
            });
        }

        let mut file_fails = false;
        let mut accepted = AcceptedPointers::default();

        for mismatch in mismatches {
            let outcome = match &output_file {
                Some(file) => self.ledger.take(
                    ComparedFile {
                        fixture: &fixture.path,
                        file,
                    },
                    &mismatch,
                ),
                None => MatchOutcome::Unmatched,
            };

            if outcome == MatchOutcome::Accepted {
                accepted.note(&mismatch);

                continue;
            }

            file_fails = true;
            self.note_failure(
                fixture,
                name,
                &mismatch,
                &outcome,
                (expected_text, actual_text),
            );
        }

        if !file_fails
            && let (Some(expected_text), Some(actual_text)) = (expected_text, actual_text)
            && !accepted.is_empty()
            && !identical_outside_accepted(expected_text, actual_text, &accepted)
        {
            file_fails = true;
            self.note_failure(
                fixture,
                name,
                &text_beyond_accepted(),
                &MatchOutcome::Unmatched,
                (Some(expected_text), Some(actual_text)),
            );
        }

        if file_fails {
            tally.failing_files += 1;
        }

        Ok(())
    }

    /// Keeps the first failure of the run only.
    fn note_failure(
        &mut self,
        fixture: &Fixture,
        name: &str,
        mismatch: &Mismatch,
        outcome: &MatchOutcome,
        texts: (Option<&str>, Option<&str>),
    ) {
        if self.verdict.first_failure.is_none() {
            self.verdict.first_failure =
                Some(first_failure(fixture, name, mismatch, outcome, texts));
        }
    }

    fn file_mismatches(
        &self,
        fixture: &Fixture,
        name: &str,
        expected_text: Option<&str>,
        actual_text: Option<&str>,
    ) -> Result<Vec<Mismatch>, OracleError> {
        let json_error = |source| OracleError::Json {
            path: self.expected_path(fixture, name),
            source,
        };

        match (expected_text, actual_text) {
            (Some(expected_text), Some(actual_text)) => {
                text_mismatches(expected_text, actual_text).map_err(json_error)
            }
            (Some(expected_text), None) => {
                let expected: Value = serde_json::from_str(expected_text).map_err(json_error)?;

                Ok(vec![only_in_one(
                    String::new(),
                    MismatchKind::Removed,
                    &expected,
                )])
            }
            (None, Some(actual_text)) => Ok(vec![compiled_only(actual_text)]),
            (None, None) => Ok(Vec::new()),
        }
    }
}

/// The mismatch of a file only the compiler wrote.
fn compiled_only(actual_text: &str) -> Mismatch {
    match serde_json::from_str::<Value>(actual_text) {
        Ok(actual) => only_in_one(String::new(), MismatchKind::Added, &actual),
        Err(_) => Mismatch {
            pointer: None,
            kind: MismatchKind::Unparsable,
            expected: None,
            actual: None,
        },
    }
}

fn first_failure(
    fixture: &Fixture,
    name: &str,
    mismatch: &Mismatch,
    outcome: &MatchOutcome,
    (expected_text, actual_text): (Option<&str>, Option<&str>),
) -> FirstFailure {
    let (expected_context, actual_context) = mismatch_context(expected_text, actual_text, mismatch);

    let summary = match outcome {
        MatchOutcome::Ambiguous(entry_ids) => format!(
            "{}; matched by more than one difference: {}",
            mismatch.summary(),
            entry_ids.join(", ")
        ),
        MatchOutcome::Accepted | MatchOutcome::Unmatched => mismatch.summary(),
    };

    FirstFailure {
        fixture: fixture.path.clone(),
        file: name.to_owned(),
        pointer: mismatch.pointer.clone(),
        summary,
        expected_context,
        actual_context,
    }
}
