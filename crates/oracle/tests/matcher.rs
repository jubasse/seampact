//! The matching of mismatches against intended differences, on hand-built mismatches.

#![cfg(test)]

use seampact_oracle::{
    Applies, ComparedFile, Difference, DifferenceChange, DifferenceLedger, MatchOutcome, Mismatch,
    OutputFile, OutputKind, value_mismatches,
};
use serde_json::Value;

const FIXTURE: &str = "big-integers/above-2-pow-53";

fn number(token: &str) -> Value {
    serde_json::from_str(token).unwrap()
}

fn difference(id: &str, fixture_glob: &str, pointer: &str, change: DifferenceChange) -> Difference {
    Difference {
        id: id.to_owned(),
        reason: "A test difference.".to_owned(),
        decision: "docs/adr/0031-rust-core.md#decision".to_owned(),
        applies: Applies {
            fixtures: vec![fixture_glob.to_owned()],
            output: OutputKind::Ir,
            api: None,
            half: None,
            pointer: Some(pointer.to_owned()),
            path: None,
        },
        change,
        from: None,
        to: None,
    }
}

fn ir_file() -> OutputFile {
    OutputFile::of("ir/bigints.json").unwrap()
}

fn only_mismatch(expected: &str, actual: &str) -> Mismatch {
    let mut mismatches = value_mismatches(
        &serde_json::from_str(expected).unwrap(),
        &serde_json::from_str(actual).unwrap(),
    );

    assert_eq!(mismatches.len(), 1, "{mismatches:?}");

    mismatches.remove(0)
}

fn outcome(differences: Vec<Difference>, fixture: &str, mismatch: &Mismatch) -> MatchOutcome {
    let file = ir_file();
    let compared = ComparedFile {
        fixture,
        file: &file,
    };
    let mut ledger = DifferenceLedger::new(differences);

    ledger.record_compared(compared);
    ledger.take(compared, mismatch)
}

#[test]
fn from_and_to_compare_number_tokens_above_2_pow_53_exactly() {
    let mismatch = only_mismatch(
        r#"{"a": 9223372036854776000}"#,
        r#"{"a": 9223372036854775807}"#,
    );
    let mut exact = difference("exact", "big-integers/**", "/a", DifferenceChange::Value);

    exact.from = Some(number("9223372036854776000"));
    exact.to = Some(number("9223372036854775807"));

    let mut rounded_to = exact.clone();

    rounded_to.to = Some(number("9223372036854775808"));

    assert_eq!(
        outcome(vec![exact], FIXTURE, &mismatch),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![rounded_to], FIXTURE, &mismatch),
        MatchOutcome::Unmatched
    );
}

#[test]
fn a_star_segment_matches_any_one_segment_only() {
    let mismatch = only_mismatch(
        r#"{"s": {"Counter": {"d": 1}}}"#,
        r#"{"s": {"Counter": {"d": 2}}}"#,
    );

    let star = difference("star", "big-integers/**", "/s/*/d", DifferenceChange::Value);
    let short = difference("short", "big-integers/**", "/s/*", DifferenceChange::Value);

    assert_eq!(
        outcome(vec![star], FIXTURE, &mismatch),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![short], FIXTURE, &mismatch),
        MatchOutcome::Unmatched
    );
}

#[test]
fn a_double_star_fixture_glob_matches_its_directory_and_below_but_no_sibling() {
    let mismatch = only_mismatch("[1]", "[2]");
    let entry = difference("tree", "big-integers/**", "/0", DifferenceChange::Value);

    assert_eq!(
        outcome(vec![entry.clone()], "big-integers", &mismatch),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![entry.clone()], FIXTURE, &mismatch),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![entry], "big-integers-other", &mismatch),
        MatchOutcome::Unmatched
    );
}

#[test]
fn two_entries_matching_one_mismatch_are_ambiguous() {
    let mismatch = only_mismatch("[1]", "[2]");
    let first = difference("first", "big-integers/**", "/0", DifferenceChange::Value);
    let second = difference("second", "**", "/*", DifferenceChange::Value);

    assert_eq!(
        outcome(vec![first, second], FIXTURE, &mismatch),
        MatchOutcome::Ambiguous(vec!["first".to_owned(), "second".to_owned()])
    );
}

#[test]
fn the_change_kind_and_the_last_segment_must_fit() {
    let added = only_mismatch("[]", "[1]");
    let message = only_mismatch(r#"{"message": "a"}"#, r#"{"message": "b"}"#);

    let removed_entry = difference("removed", "**", "/0", DifferenceChange::Removed);
    let added_entry = difference("added", "**", "/0", DifferenceChange::Added);
    let message_entry = difference("message", "**", "/message", DifferenceChange::Message);
    let renamed_entry = difference("renamed", "**", "/message", DifferenceChange::CodeRenamed);

    assert_eq!(
        outcome(vec![removed_entry], FIXTURE, &added),
        MatchOutcome::Unmatched
    );
    assert_eq!(
        outcome(vec![added_entry], FIXTURE, &added),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![message_entry], FIXTURE, &message),
        MatchOutcome::Accepted
    );
    assert_eq!(
        outcome(vec![renamed_entry], FIXTURE, &message),
        MatchOutcome::Unmatched
    );
}

#[test]
fn an_entry_is_stale_only_when_a_file_in_its_scope_was_compared_and_it_matched_nothing() {
    let file = ir_file();
    let in_scope = difference("in-scope", "big-integers/**", "/0", DifferenceChange::Value);
    let out_of_scope = difference("out-of-scope", "golden/**", "/0", DifferenceChange::Value);
    let matched = difference("matched", "big-integers/**", "/1", DifferenceChange::Value);
    let mut ledger = DifferenceLedger::new(vec![in_scope, out_of_scope, matched]);
    let compared = ComparedFile {
        fixture: FIXTURE,
        file: &file,
    };

    ledger.record_compared(compared);
    ledger.take(compared, &only_mismatch("[0, 1]", "[0, 2]"));

    assert_eq!(ledger.stale_ids(), vec!["in-scope"]);
}
