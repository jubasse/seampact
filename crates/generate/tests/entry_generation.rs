//! The generation of the entries of an app through the probe generators, in link order.

mod support;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::{AppChecksSettings, LoadedAppConfig, WarningsSettings};
use seampact_gen_probe::{PROBE_CLIENT, PROBE_PROVIDER, PROBE_SERVER};
use seampact_generate::{AppPlan, Stop, generate_entries};
use seampact_json::JsonValue;
use support::{TestResult, planned_entry, reference_ir};

fn app_config(ignored_warnings: &[&str]) -> TestResult<LoadedAppConfig> {
    Ok(LoadedAppConfig {
        file: Utf8PathBuf::from("/app/seampact.config.yaml"),
        out_dir: Utf8PathBuf::from("/app"),
        allow_local: None,
        sources: IndexMap::new(),
        entries: Vec::new(),
        openapi: None,
        checks: AppChecksSettings::from_value(None::<&JsonValue>)?,
        diff: None,
        warnings: WarningsSettings {
            ignore: ignored_warnings
                .iter()
                .map(|each| (*each).to_owned())
                .collect(),
        },
        root_file: None,
        written: JsonValue::Null,
    })
}

fn plan_of(config: &LoadedAppConfig, entries: Vec<seampact_generate::PlannedEntry>) -> AppPlan<'_> {
    AppPlan {
        config,
        entries,
        documents: Vec::new(),
        default_document_directory: Utf8PathBuf::from("/app/openapi"),
        compiled: Vec::new(),
    }
}

#[test]
fn a_generated_file_is_finished_and_a_warning_the_config_ignores_is_dropped() -> TestResult<()> {
    let ir = reference_ir()?;
    let entry = planned_entry(
        r#"{"id":"api","use":"probe-provider","options":{"files":[{"path":"a.json","contents":"{\"a\":1}"}],"warnings":[{"code":"form.handler","message":"m","fix":"f"},{"code":"other.handler","message":"m","fix":"f"}]}}"#,
        &PROBE_PROVIDER,
        Some(&ir),
    )?;
    let config = app_config(&["form"])?;
    let outputs = generate_entries(&plan_of(&config, vec![entry]), Some("web"))
        .map_err(|stop| format!("{stop:?}"))?;
    let [output] = outputs.as_slice() else {
        return Err(format!("outputs: {outputs:?}").into());
    };

    assert_eq!(output.entry_id, "api");
    assert_eq!(output.app.as_deref(), Some("web"));
    assert_eq!(
        output
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["a.json"]
    );
    assert_eq!(
        output
            .warnings
            .iter()
            .map(|warning| warning.code.as_str())
            .collect::<Vec<_>>(),
        ["other.handler"]
    );

    Ok(())
}

#[test]
fn a_refusal_of_the_target_is_located_at_the_entry_and_api() -> TestResult<()> {
    let ir = reference_ir()?;
    let entry = planned_entry(
        r#"{"id":"api","use":"probe-provider","options":{"refusals":[{"code":"probe.refused","message":"no","fix":"yes"}]}}"#,
        &PROBE_PROVIDER,
        Some(&ir),
    )?;
    let config = app_config(&[])?;
    let Err(Stop::Refused(problems)) = generate_entries(&plan_of(&config, vec![entry]), None)
    else {
        return Err("the refusal was not reported".into());
    };
    let [problem] = problems.as_slice() else {
        return Err(format!("problems: {problems:?}").into());
    };

    assert_eq!(problem.code, "probe.refused");
    assert_eq!(
        problem.location.as_deref(),
        Some("entry 'api', api 'tasks'")
    );
    assert!(problem.docs.is_some(), "problem: {problem:?}");

    Ok(())
}

#[test]
fn a_provider_the_target_refuses_to_describe_is_reported_at_its_consumer() -> TestResult<()> {
    let ir = reference_ir()?;
    let provider = planned_entry(
        r#"{"id":"api","use":"probe-provider","options":{"refusals":[{"code":"probe.describe","message":"no","fix":"yes"}]}}"#,
        &PROBE_PROVIDER,
        Some(&ir),
    )?;
    let consumer = planned_entry(
        r#"{"id":"web","use":"probe-client","link":{"client":"api"}}"#,
        &PROBE_CLIENT,
        Some(&ir),
    )?;
    let config = app_config(&[])?;
    let Err(Stop::Refused(problems)) =
        generate_entries(&plan_of(&config, vec![provider, consumer]), None)
    else {
        return Err("the refusal was not reported".into());
    };
    let codes: Vec<&str> = problems
        .as_slice()
        .iter()
        .map(|each| each.code.as_str())
        .collect();

    assert!(codes.contains(&"probe.describe"), "codes: {codes:?}");
    assert!(
        problems.as_slice().iter().any(
            |each| each.location.as_deref() == Some("entry 'web' linked to 'api', api 'tasks'")
        ),
        "problems: {problems:?}"
    );

    Ok(())
}

#[test]
fn two_exclusive_servers_on_one_base_path_are_refused() -> TestResult<()> {
    let ir = reference_ir()?;
    let first = planned_entry(
        r#"{"id":"one","use":"probe-server"}"#,
        &PROBE_SERVER,
        Some(&ir),
    )?;
    let second = planned_entry(
        r#"{"id":"two","use":"probe-server"}"#,
        &PROBE_SERVER,
        Some(&ir),
    )?;
    let config = app_config(&[])?;
    let Err(Stop::Refused(problems)) =
        generate_entries(&plan_of(&config, vec![first, second]), None)
    else {
        return Err("the overlap was not reported".into());
    };

    assert!(
        problems
            .as_slice()
            .iter()
            .any(|each| each.code == "path.base.shared.unsupported"
                && each.location.as_deref() == Some("entry 'two', api 'tasks'")),
        "problems: {problems:?}"
    );

    Ok(())
}

#[test]
fn consumers_that_ask_for_different_import_styles_are_refused() -> TestResult<()> {
    let ir = reference_ir()?;
    let provider = planned_entry(
        r#"{"id":"api","use":"probe-provider"}"#,
        &PROBE_PROVIDER,
        Some(&ir),
    )?;
    // `probe-client` asks for `extensionless`; a server entry has no style of its own, so it asks `js`.
    let client = planned_entry(
        r#"{"id":"web","use":"probe-client","link":{"client":"api"}}"#,
        &PROBE_CLIENT,
        Some(&ir),
    )?;
    let server = planned_entry(
        r#"{"id":"srv","use":"probe-server","link":{"validators":"api"}}"#,
        &PROBE_SERVER,
        Some(&ir),
    )?;
    let config = app_config(&[])?;
    let Err(Stop::Refused(problems)) =
        generate_entries(&plan_of(&config, vec![provider, client, server]), None)
    else {
        return Err("the mixed styles were not reported".into());
    };

    assert!(
        problems
            .as_slice()
            .iter()
            .any(|each| each.code == "link.importSpecifiers.mixed"
                && each.message.contains("'web' import with 'extensionless' specifiers; 'srv' import with 'js' specifiers")),
        "problems: {problems:?}"
    );

    Ok(())
}
