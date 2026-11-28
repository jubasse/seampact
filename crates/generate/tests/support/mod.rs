//! The reference IR and the planned entries the run planning tests build on.

#![allow(dead_code, reason = "each test file uses part of the shared support")]

use camino::Utf8PathBuf;
use seampact_cli_config::{ConfiguredTargetEntry, TargetEntrySettings};
use seampact_generate::{PlannedApi, PlannedEntry};
use seampact_ir::ContractIr;
use seampact_target::{ArtefactSet, Generator, InstalledRuntimes, ResolvedLinkNeeds};

pub type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

pub fn reference_ir() -> TestResult<ContractIr> {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/expected/reference/ir/tasks.json"
    ))?;

    Ok(ContractIr::from_json_text(&text)?)
}

pub fn settings(text: &str) -> TestResult<TargetEntrySettings> {
    Ok(serde_json::from_str(text)?)
}

pub fn planned_entry(
    entry: &str,
    target: &'static dyn Generator,
    ir: Option<&ContractIr>,
) -> TestResult<PlannedEntry> {
    let apis = ir
        .map(|ir| PlannedApi {
            api: "tasks".to_owned(),
            source: "contract".to_owned(),
            ir: ir.clone(),
            root: Utf8PathBuf::from("/out"),
            located: None,
        })
        .into_iter()
        .collect();

    let mut planned = PlannedEntry::resolved(
        &ConfiguredTargetEntry {
            settings: settings(entry)?,
            root: Utf8PathBuf::from("/out"),
        },
        target,
        ArtefactSet::new(std::iter::empty::<String>()),
        ResolvedLinkNeeds::NONE,
        InstalledRuntimes::NONE,
    );

    planned.apis = apis;

    Ok(planned)
}
