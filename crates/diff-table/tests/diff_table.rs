//! Behaviour of the table lookups and the options the oracle's one case does not reach.

use std::collections::HashSet;

use seampact_diff_table::{
    DiffBreak, DiffClassification, DiffExemption, DiffFact, DiffGateScope, DiffKind, DiffOptions,
    DiffPosition, DiffTableError, IrDefinition, MemberRow, classify_cell, member_row,
    resolve_diff_options,
};

fn facts(listed: &[DiffFact]) -> HashSet<DiffFact> {
    listed.iter().copied().collect()
}

fn options(today: &str, exempt: Option<Vec<DiffExemption>>) -> DiffOptions {
    DiffOptions {
        today: today.to_owned(),
        gate: None,
        exempt,
    }
}

#[test]
fn a_conditional_cell_follows_its_fact() {
    let held = classify_cell(
        DiffKind::PropertyRemoved,
        "optional",
        DiffPosition::Input,
        &facts(&[DiffFact::AfterRefusesUnknownKeys]),
    );
    let not_held = classify_cell(
        DiffKind::PropertyRemoved,
        "optional",
        DiffPosition::Input,
        &facts(&[]),
    );

    assert_eq!(
        held.map(|outcome| outcome.breaks),
        Some(vec![DiffBreak::Clients])
    );
    assert_eq!(
        not_held.map(|outcome| outcome.classification),
        Some(DiffClassification::Additive)
    );
}

#[test]
fn a_free_text_row_ignores_the_case_name() {
    for case_name in ["any", "whatever", "", "constructor", "__proto__"] {
        let outcome = classify_cell(
            DiffKind::Unclassified,
            case_name,
            DiffPosition::None,
            &facts(&[]),
        );

        assert_eq!(
            outcome.map(|found| found.breaks),
            Some(vec![DiffBreak::Clients, DiffBreak::Servers]),
            "case {case_name:?}"
        );
    }
}

#[test]
fn an_absent_case_or_position_has_no_cell() {
    let none = facts(&[]);

    assert_eq!(
        classify_cell(
            DiffKind::OperationAdded,
            "removed",
            DiffPosition::None,
            &none
        ),
        None
    );
    assert_eq!(
        classify_cell(
            DiffKind::OperationAdded,
            "added",
            DiffPosition::Input,
            &none
        ),
        None
    );
    assert_eq!(
        classify_cell(
            DiffKind::OperationAdded,
            "toString",
            DiffPosition::None,
            &none
        ),
        None
    );
}

#[test]
fn a_member_is_looked_up_by_definition_then_name() {
    assert_eq!(
        member_row(IrDefinition::ErrorHttp, "status"),
        MemberRow::Fixed {
            kind: DiffKind::Error,
            case_name: "status"
        }
    );
    assert_eq!(
        member_row(IrDefinition::Name, "segments"),
        MemberRow::Kind(DiffKind::Name)
    );
}

#[test]
fn an_unlisted_member_is_unclassified() {
    for (definition, member) in [
        (IrDefinition::Name, "nothing"),
        (IrDefinition::Name, "constructor"),
        (IrDefinition::Docs, "length"),
    ] {
        assert_eq!(
            member_row(definition, member),
            MemberRow::Kind(DiffKind::Unclassified),
            "{}.{member}",
            definition.as_str()
        );
    }
}

#[test]
fn the_options_take_their_defaults() {
    let resolved = resolve_diff_options(&options("2026-01-01", None));

    assert_eq!(
        resolved.map(|found| (found.gate, found.exempt)),
        Ok((
            DiffGateScope::Clients,
            vec![DiffExemption::Experimental, DiffExemption::SunsetPassed]
        ))
    );
}

#[test]
fn the_exemptions_are_sorted_and_without_repeats() {
    let resolved = resolve_diff_options(&options(
        "2026-01-01",
        Some(vec![
            DiffExemption::SunsetPassed,
            DiffExemption::Experimental,
            DiffExemption::SunsetPassed,
        ]),
    ));

    assert_eq!(
        resolved.map(|found| found.exempt),
        Ok(vec![
            DiffExemption::Experimental,
            DiffExemption::SunsetPassed
        ])
    );
    assert_eq!(
        resolve_diff_options(&options("2026-01-01", Some(Vec::new()))).map(|found| found.exempt),
        Ok(Vec::new())
    );
}

#[test]
fn a_date_that_does_not_exist_is_refused_with_its_json_text() {
    for (today, quoted) in [
        ("2026-02-30", "\"2026-02-30\""),
        ("26-1-1", "\"26-1-1\""),
        ("say \"hi\"\n", "\"say \\\"hi\\\"\\n\""),
        ("\u{e9}", "\"\u{e9}\""),
    ] {
        let error = resolve_diff_options(&options(today, None));

        assert_eq!(
            error.map(|found| found.today),
            Err(DiffTableError::InvalidToday {
                today: quoted.to_owned()
            }),
            "today {today:?}"
        );
    }
}

#[test]
fn the_refusal_reads_as_the_typescript_message() {
    let error = DiffTableError::InvalidToday {
        today: "\"x\"".to_owned(),
    };

    assert_eq!(
        error.to_string(),
        "diff options: today is \"x\", not a calendar date. Fix: pass today as YYYY-MM-DD."
    );
}
