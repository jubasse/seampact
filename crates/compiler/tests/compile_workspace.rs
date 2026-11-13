//! The run of `compile_workspace` over the repository's fixtures, and the checks the orchestrator
//! makes on the relay stage.

use std::collections::HashSet;
use std::error::Error;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_compiler::{
    PipelineOptions, PipelineRun, RelayOrder, Stage, check_relay_order, compile_workspace,
    relays_to_stopped,
};
use seampact_diagnostics::Severity;
use seampact_load::{FsReader, LoadOptions};

fn fixture_directory(path: &str) -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(path)
}

fn compile_fixture(path: &str, entry: &str) -> Result<PipelineRun, Box<dyn Error>> {
    let reader = FsReader::new(&fixture_directory(path))?;
    let no_imports = IndexMap::new();
    let options = PipelineOptions {
        load: LoadOptions {
            reader: &reader,
            entry,
        },
        imports: &no_imports,
    };

    Ok(compile_workspace(&options)?)
}

#[test]
fn a_load_error_stops_the_run_with_the_sorted_workspace_diagnostics_and_no_api()
-> Result<(), Box<dyn Error>> {
    let run = compile_fixture("loader/composition/file-missing", "api.yaml")?;
    let PipelineRun::Finished(result) = run else {
        return Err(format!("a load error finishes the run, got {run:?}").into());
    };

    assert_eq!(result.apis, Vec::new());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
    );
    assert!(result.read_files.contains(&"api.yaml".to_owned()));
    assert!(!result.source_files.is_empty());

    Ok(())
}

#[test]
fn a_clean_load_reaches_validate_which_is_not_ported() -> Result<(), Box<dyn Error>> {
    let run = compile_fixture("reference", "workspace.yaml")?;

    assert!(
        matches!(run, PipelineRun::NotPorted(Stage::Validate)),
        "{run:?}"
    );

    Ok(())
}

fn relay_of(order: &[&str]) -> RelayOrder {
    RelayOrder {
        order: order.iter().map(|api| (*api).to_owned()).collect(),
        ..RelayOrder::default()
    }
}

#[test]
fn a_relay_order_that_lists_every_api_once_is_accepted_in_any_order() {
    assert!(check_relay_order(&relay_of(&["b", "a"]), &["a", "b"]).is_ok());
    assert!(check_relay_order(&relay_of(&[]), &[]).is_ok());
}

#[test]
fn a_relay_order_that_misses_repeats_or_adds_an_api_is_an_internal_error() {
    let workspace_apis = ["a", "b"];

    for order in [&["a"][..], &["a", "a"], &["a", "c"], &["a", "b", "c"], &[]] {
        let failure = check_relay_order(&relay_of(order), &workspace_apis)
            .expect_err(&format!("{order:?} is not a relay order of a and b"));

        assert_eq!(
            failure.what(),
            "the relay order must list every workspace api once, and no other name"
        );
    }
}

fn relays(edges: &[(&str, &[&str])]) -> IndexMap<String, Vec<String>> {
    edges
        .iter()
        .map(|(api, targets)| {
            (
                (*api).to_owned(),
                targets.iter().map(|target| (*target).to_owned()).collect(),
            )
        })
        .collect()
}

fn stopped_of(apis: &[&str]) -> HashSet<String> {
    apis.iter().map(|api| (*api).to_owned()).collect()
}

#[test]
fn an_api_relaying_to_a_stopped_api_directly_or_through_another_is_skipped() {
    let relays_to = relays(&[("c", &["b"]), ("b", &["a"])]);
    let stopped = stopped_of(&["a"]);

    assert!(relays_to_stopped("b", &relays_to, &stopped));
    assert!(relays_to_stopped("c", &relays_to, &stopped));
    assert!(!relays_to_stopped("a", &relays_to, &stopped));
}

#[test]
fn an_api_with_no_relay_or_no_stopped_target_is_not_skipped() {
    let relays_to = relays(&[("b", &["a"])]);

    assert!(!relays_to_stopped("b", &relays_to, &stopped_of(&[])));
    assert!(!relays_to_stopped("z", &relays_to, &stopped_of(&["a"])));
}

#[test]
fn a_relay_cycle_ends_the_search_instead_of_looping() {
    let relays_to = relays(&[("a", &["b"]), ("b", &["a"])]);

    assert!(!relays_to_stopped("a", &relays_to, &stopped_of(&["z"])));
    assert!(relays_to_stopped("a", &relays_to, &stopped_of(&["b"])));
}
