//! A whole oracle run over the committed fixtures with test subjects.

#![cfg(test)]

mod support;

use std::cell::RefCell;

use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, Fixture, FixtureGlob, HalfInput, OracleSubject, RuleIdRegistry, Selection,
    SubjectAnswer, run_oracle,
};
use support::{
    ExpectedFilesSubject, SCRATCH_FIXTURE, repository_root, scratch_repository, unchanged,
};

/// A fixture whose expected diagnostics hold an error with a message.
const FIXTURE_WITH_DIAGNOSTICS: &str = "scale/notify";

/// A subject with no stage ported.
struct NothingPorted;

impl OracleSubject for NothingPorted {
    fn compile(&self, _fixture: &Fixture) -> SubjectAnswer<Compilation> {
        SubjectAnswer::NotPorted
    }

    fn run_half(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _half: &str,
        _input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue> {
        SubjectAnswer::NotPorted
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

/// The Rust port's exact integers in place of the rounded ones of the TS oracle.
fn exact_big_integers(_name: &str, text: &str) -> String {
    text.replace("9223372036854776000", "9223372036854775807")
        .replace("9007199254740992", "9007199254740993")
}

/// The exact integers, and the IR written with tabs in place of two spaces.
fn exact_integers_in_tab_indented_ir(name: &str, text: &str) -> String {
    let exact = exact_big_integers(name, text);

    if !name.starts_with("ir/") {
        return exact;
    }

    let lines: Vec<String> = exact
        .lines()
        .map(|line| {
            let content = line.trim_start_matches(' ');
            let indent_width = line.len() - content.len();

            format!("{}{content}", "\t".repeat(indent_width / 2))
        })
        .collect();

    format!("{}\n", lines.join("\n"))
}

/// One diagnostics message changed in one fixture.
fn one_changed_message(name: &str, text: &str) -> String {
    if name == "diagnostics.json" && text.contains("\"message\": ") {
        return text.replacen("\"message\": \"", "\"message\": \"Changed: ", 1);
    }

    text.to_owned()
}

#[test]
fn a_subject_with_nothing_ported_passes_and_counts_every_fixture_not_ported() {
    let verdict = run_oracle(&repository_root(), &Selection::default(), &NothingPorted).unwrap();

    assert!(verdict.fixtures > 0);
    assert_eq!(verdict.not_ported, verdict.fixtures);
    assert_eq!(verdict.compared(), 0);
    assert!(verdict.passed(), "{verdict}");
    assert!(verdict.to_string().contains("\nrule ids: 0 of "));
}

#[test]
fn the_expected_files_themselves_all_match_and_leave_the_exact_integer_entries_stale() {
    let subject = ExpectedFilesSubject {
        repository_root: repository_root(),
        rewrite: unchanged,
    };

    let verdict = run_oracle(&repository_root(), &Selection::default(), &subject).unwrap();

    assert_eq!(verdict.matching, verdict.fixtures);
    assert_eq!(verdict.first_failure, None);
    assert_eq!(
        verdict.problems,
        [
            "big-integers-exact",
            "big-integers-exact-tree-schemas",
            "big-integers-exact-derive-errors"
        ]
        .map(|id| format!(
            "difference {id} matched no mismatch: delete it from fixtures/expected/differences.yaml"
        ))
    );
}

#[test]
fn the_exact_integers_of_the_rust_port_are_accepted_by_the_committed_differences() {
    let subject = ExpectedFilesSubject {
        repository_root: repository_root(),
        rewrite: exact_big_integers,
    };

    let verdict = run_oracle(&repository_root(), &Selection::default(), &subject).unwrap();

    assert!(verdict.passed(), "{verdict}");
    assert_eq!(verdict.matching, verdict.fixtures);
}

#[test]
fn an_accepted_value_does_not_excuse_other_bytes_of_the_file() {
    let subject = ExpectedFilesSubject {
        repository_root: repository_root(),
        rewrite: exact_integers_in_tab_indented_ir,
    };
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new("big-integers/**")),
        half: None,
    };

    let verdict = run_oracle(&repository_root(), &selection, &subject).unwrap();
    let failure = verdict.first_failure.clone().unwrap();

    assert!(!verdict.passed(), "{verdict}");
    assert_eq!((verdict.fixtures, verdict.differing), (1, 1));
    assert!(failure.file.starts_with("ir/"), "{failure}");
    assert_eq!(failure.pointer, None);
    assert_eq!(
        failure.summary,
        "the text differs beyond the values (layout, string escapes or number notation)"
    );
}

#[test]
fn one_changed_value_is_the_first_mismatch_at_its_pointer() {
    let subject = ExpectedFilesSubject {
        repository_root: repository_root(),
        rewrite: one_changed_message,
    };
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new(FIXTURE_WITH_DIAGNOSTICS)),
        half: None,
    };

    let verdict = run_oracle(&repository_root(), &selection, &subject).unwrap();
    let failure = verdict.first_failure.clone().unwrap();

    assert_eq!(verdict.fixtures, 1);
    assert_eq!(verdict.differing, 1);
    assert_eq!(failure.fixture, FIXTURE_WITH_DIAGNOSTICS);
    assert_eq!(failure.file, "diagnostics.json");
    assert_eq!(
        failure.pointer.as_deref(),
        Some("/apis/0/diagnostics/0/message")
    );
    assert_eq!(
        failure.summary,
        "the value at /apis/0/diagnostics/0/message differs"
    );
    assert!(
        failure
            .actual_context
            .iter()
            .any(|line| line.contains("\"message\": \"Changed: ")),
        "{failure}"
    );
}

#[test]
fn a_half_run_compares_that_half_only() {
    let subject = ExpectedFilesSubject {
        repository_root: repository_root(),
        rewrite: exact_big_integers,
    };
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new("big-integers/**")),
        half: Some("derive.errors".to_owned()),
    };

    let verdict = run_oracle(&repository_root(), &selection, &subject).unwrap();

    assert!(verdict.passed(), "{verdict}");
    assert_eq!((verdict.fixtures, verdict.matching), (1, 1));
}

#[test]
fn a_glob_matching_no_fixture_and_an_unknown_half_are_usage_errors() {
    let no_fixture = Selection {
        fixture_glob: Some(FixtureGlob::new("no-such-fixture")),
        half: None,
    };
    let no_half = Selection {
        fixture_glob: None,
        half: Some("no.such-half".to_owned()),
    };

    for selection in [no_fixture, no_half] {
        let error = run_oracle(&repository_root(), &selection, &NothingPorted).unwrap_err();

        assert!(error.is_usage(), "{error}");
    }
}

/// What one `run_half` call received: the api, the half, the halves before it, and the other
/// apis with their delta counts.
type HalfCall = (String, String, Vec<String>, Vec<(String, usize, bool)>);

/// A subject that records the input of every half it is asked to run.
struct HalfInputRecorder {
    calls: RefCell<Vec<HalfCall>>,
    previous_deltas: RefCell<Vec<JsonValue>>,
}

impl OracleSubject for HalfInputRecorder {
    fn compile(&self, _fixture: &Fixture) -> SubjectAnswer<Compilation> {
        SubjectAnswer::NotPorted
    }

    fn run_half(
        &self,
        _fixture: &Fixture,
        api: &str,
        half: &str,
        input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue> {
        let halves_before = input
            .deltas_before
            .iter()
            .map(|expected| expected.half.clone())
            .collect();
        let other_apis = input
            .other_apis
            .iter()
            .map(|other| {
                (
                    other.api.to_owned(),
                    other.deltas.len(),
                    other.expected_ir.is_some(),
                )
            })
            .collect();

        if let Some(previous) = input.deltas_before.last() {
            self.previous_deltas
                .borrow_mut()
                .push(previous.delta.clone());
        }

        self.calls
            .borrow_mut()
            .push((api.to_owned(), half.to_owned(), halves_before, other_apis));

        SubjectAnswer::NotPorted
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

#[test]
fn a_half_starts_from_the_expected_halves_before_it_and_the_other_apis_deltas() {
    let subject = HalfInputRecorder {
        calls: RefCell::new(Vec::new()),
        previous_deltas: RefCell::new(Vec::new()),
    };
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new("scale")),
        half: Some("access.identity".to_owned()),
    };

    let verdict = run_oracle(&repository_root(), &selection, &subject).unwrap();
    let calls = subject.calls.borrow();
    let scale_calls: Vec<&HalfCall> = calls.iter().take(3).collect();

    assert_eq!(verdict.not_ported, verdict.fixtures);
    assert_eq!(
        scale_calls,
        ["billing", "inventory", "notify"]
            .map(|api| {
                let other_apis = ["billing", "inventory", "notify"]
                    .into_iter()
                    .filter(|other| *other != api)
                    .map(|other| (other.to_owned(), 6, true))
                    .collect();

                (
                    api.to_owned(),
                    "access.identity".to_owned(),
                    vec!["tree.schemas".to_owned(), "tree.nodes".to_owned()],
                    other_apis,
                )
            })
            .iter()
            .collect::<Vec<_>>()
    );

    let billing_tree_nodes = std::fs::read_to_string(
        repository_root().join("fixtures/expected/scale/halves/billing/02-tree.nodes.json"),
    )
    .unwrap();

    assert_eq!(
        subject.previous_deltas.borrow().first(),
        Some(&serde_json::from_str::<JsonValue>(&billing_tree_nodes).unwrap())
    );
}

/// A subject that breaks on every fixture and every half.
struct AlwaysBreaks;

impl OracleSubject for AlwaysBreaks {
    fn compile(&self, _fixture: &Fixture) -> SubjectAnswer<Compilation> {
        SubjectAnswer::InternalError {
            message: "the tree stage broke".to_owned(),
        }
    }

    fn run_half(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _half: &str,
        _input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue> {
        SubjectAnswer::InternalError {
            message: "the half broke".to_owned(),
        }
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

#[test]
fn an_internal_error_of_the_subject_fails_the_run_naming_the_fixture() {
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new(FIXTURE_WITH_DIAGNOSTICS)),
        half: None,
    };

    let verdict = run_oracle(&repository_root(), &selection, &AlwaysBreaks).unwrap();

    assert!(!verdict.passed(), "{verdict}");
    assert_eq!(verdict.differing, 1);
    assert_eq!(
        verdict.problems.first().map(String::as_str),
        Some("internal error in scale/notify: the tree stage broke")
    );
}

#[test]
fn an_internal_error_of_a_half_names_the_fixture_the_api_and_the_half() {
    let selection = Selection {
        fixture_glob: Some(FixtureGlob::new("scale")),
        half: Some("tree.nodes".to_owned()),
    };

    let verdict = run_oracle(&repository_root(), &selection, &AlwaysBreaks).unwrap();

    assert!(!verdict.passed(), "{verdict}");
    assert_eq!(
        verdict.problems.first().map(String::as_str),
        Some("internal error in scale (api billing, half tree.nodes): the half broke")
    );
}

#[test]
fn an_expected_file_that_is_no_json_fails_the_run_naming_the_fixture_and_the_file() {
    let root = scratch_repository(
        "lone-surrogate",
        &[("diagnostics.json", r#"{ "workspace": ["\ud800"] }"#)],
    );

    let error = run_oracle(&root, &Selection::default(), &NothingPorted).unwrap_err();
    let message = error.to_string();

    assert!(!error.is_usage(), "{message}");
    assert!(
        message.contains(&format!("{SCRATCH_FIXTURE}/diagnostics.json")),
        "{message}"
    );
}

#[test]
fn an_expected_file_under_halves_with_no_half_name_is_a_problem() {
    let root = scratch_repository(
        "misnamed-half",
        &[
            ("diagnostics.json", "{}"),
            ("halves/one/01-tree.nodes.json", "{}"),
            ("halves/one/notes.json", "{}"),
            ("halves/stray.json", "{}"),
        ],
    );

    let verdict = run_oracle(&root, &Selection::default(), &NothingPorted).unwrap();

    assert!(!verdict.passed(), "{verdict}");
    assert_eq!(
        verdict.problems,
        [
            "expected/one/halves/one/notes.json is not named halves/<api>/<NN>-<half>.json: rename or delete it",
            "expected/one/halves/stray.json is not named halves/<api>/<NN>-<half>.json: rename or delete it"
        ]
    );
}
