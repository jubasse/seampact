//! The order of linked entries and the checks that each link is provided, consumed and paired.

mod support;

use seampact_generate::{links_of, order_entries};
use support::{TestResult, settings};

#[test]
fn links_come_in_the_order_javascript_lists_object_keys() -> TestResult<()> {
    let entry = settings(
        r#"{"id":"web","use":"probe-client","link":{"validators":"a","10":"c","2":"b"}}"#,
    )?;

    assert_eq!(
        links_of(&entry),
        [("2", "b"), ("10", "c"), ("validators", "a")]
    );

    Ok(())
}

#[test]
fn a_provider_comes_before_the_entries_that_link_it() -> TestResult<()> {
    let client = settings(r#"{"id":"client","use":"probe-client","link":{"client":"api"}}"#)?;
    let api = settings(r#"{"id":"api","use":"probe-provider"}"#)?;

    let ordered = order_entries(&[&client, &api]).expect("a link order");
    let ids: Vec<&str> = ordered.iter().map(|each| each.id.as_str()).collect();

    assert_eq!(ids, ["api", "client"]);

    Ok(())
}

#[test]
fn a_link_cycle_is_refused_with_its_path() -> TestResult<()> {
    let first = settings(r#"{"id":"a","use":"probe-client","link":{"client":"b"}}"#)?;
    let second = settings(r#"{"id":"b","use":"probe-client","link":{"client":"a"}}"#)?;

    let problems = order_entries(&[&first, &second])
        .expect_err("a cycle has no order")
        .into_vec();

    assert_eq!(problems.len(), 1);
    assert_eq!(
        problems.first().map(|each| each.message.as_str()),
        Some("The links form a cycle: 'a' -> 'b' -> 'a'.")
    );

    Ok(())
}
