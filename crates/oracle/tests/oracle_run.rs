//! A whole oracle run over the committed fixtures with test subjects.

#![cfg(test)]

mod support;

use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, Fixture, FixtureGlob, OracleSubject, RuleIdRegistry, Selection, SubjectAnswer,
    run_oracle,
};
use support::{ExpectedFilesSubject, repository_root, unchanged};

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
        _input: Option<&JsonValue>,
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
