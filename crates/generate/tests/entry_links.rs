//! The order of linked entries and the checks that each link is provided, consumed and paired.

mod support;

use seampact_gen_probe::{PROBE_CLIENT, PROBE_PROVIDER, PROBE_SERVER};
use seampact_generate::{
    links_of, order_entries, unconsumed_kind_problems, unknown_link_entry_problems,
    unprovided_kind_problems,
};
use support::{TestResult, planned_entry, reference_ir, settings};

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

#[test]
fn a_link_naming_no_entry_is_refused() -> TestResult<()> {
    let client = settings(r#"{"id":"client","use":"probe-client","link":{"client":"ghost"}}"#)?;
    let problems = unknown_link_entry_problems(&[&client]);

    assert_eq!(problems.len(), 1);
    assert_eq!(
        problems.first().and_then(|each| each.location.as_deref()),
        Some("entry 'client' linked to 'ghost'")
    );

    Ok(())
}

#[test]
fn a_kind_the_provider_does_not_provide_and_the_consumer_does_not_consume_are_named()
-> TestResult<()> {
    let ir = reference_ir()?;
    let server = planned_entry(
        r#"{"id":"server","use":"probe-server","link":{"types":"api"}}"#,
        &PROBE_SERVER,
        Some(&ir),
    )?;
    let provider = planned_entry(
        r#"{"id":"api","use":"probe-provider","link":{"client":"server"}}"#,
        &PROBE_PROVIDER,
        Some(&ir),
    )?;
    let client = planned_entry(
        r#"{"id":"web","use":"probe-client"}"#,
        &PROBE_CLIENT,
        Some(&ir),
    )?;
    let planned = [server, provider, client];

    let unprovided = unprovided_kind_problems(&planned);
    let unconsumed = unconsumed_kind_problems(&planned);

    assert_eq!(
        unprovided
            .iter()
            .map(|each| each.message.as_str())
            .collect::<Vec<_>>(),
        ["'server' (probe-server) does not provide 'client'; it provides nothing."]
    );
    assert_eq!(
        unconsumed
            .iter()
            .map(|each| each.message.as_str())
            .collect::<Vec<_>>(),
        [
            "'server' (probe-server) does not consume 'types', linked to 'api'; it consumes validators.",
            "'api' (probe-provider) does not consume 'client', linked to 'server'; it consumes nothing."
        ]
    );

    Ok(())
}
