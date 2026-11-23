//! The keys of an entry that tune a boot check its target does not generate.

mod support;

use seampact_gen_probe::{PROBE_CLIENT, PROBE_SERVER};
use seampact_generate::unread_framework_route_key_problems;
use support::{TestResult, settings};

fn messages(entry: &str, server: bool) -> TestResult<Vec<String>> {
    let entry = settings(entry)?;
    let target: &dyn seampact_target::Generator =
        if server { &PROBE_SERVER } else { &PROBE_CLIENT };

    Ok(unread_framework_route_key_problems(&entry, target)
        .into_iter()
        .map(|problem| problem.message)
        .collect())
}

#[test]
fn an_empty_framework_routes_list_is_still_a_key_the_target_does_not_read() -> TestResult<()> {
    let written = messages(
        r#"{"id":"web","use":"probe-client","frameworkRoutes":[]}"#,
        false,
    )?;
    let absent = messages(r#"{"id":"web","use":"probe-client"}"#, false)?;

    assert_eq!(
        written,
        ["The target 'probe-client' generates no boot check that reads 'frameworkRoutes'."]
    );
    assert!(absent.is_empty(), "absent: {absent:?}");

    Ok(())
}

#[test]
fn a_server_reads_the_route_keys_and_the_mount() -> TestResult<()> {
    let problems = messages(
        r#"{"id":"api","use":"probe-server","mount":"/v1","frameworkRoutes":[{"path":"/x","reason":"r"}]}"#,
        true,
    )?;

    assert!(problems.is_empty(), "problems: {problems:?}");

    Ok(())
}
