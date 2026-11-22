//! Behaviour of the options the oracle's one case does not reach.

use seampact_diff_table::{
    DiffExemption, DiffGateScope, DiffOptions, DiffTableError, resolve_diff_options,
};

fn options(today: &str, exempt: Option<Vec<DiffExemption>>) -> DiffOptions {
    DiffOptions {
        today: today.to_owned(),
        gate: None,
        exempt,
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
