//! Reading the repository's draft fixtures for the integration tests.

use std::fs;
use std::path::PathBuf;

use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{DraftIr, Half, draft_apply};

#[path = "../../../../json/tests/support/mod.rs"]
mod repository_files;

pub use repository_files::{files_under, repository_root};

/// The apis of the reference contract that have draft fixtures.
pub const FIXTURE_APIS: [&str; 2] = ["tasks", "tasksService"];

/// The draft fixture files: tree writes the first, access the second.
#[derive(Debug, Clone, Copy)]
pub enum DraftFixtureFile {
    /// `<api>.after-tree.json`.
    AfterTree,
    /// `<api>.access-delta.json`.
    AccessDelta,
}

impl DraftFixtureFile {
    fn name(self) -> &'static str {
        match self {
            Self::AfterTree => "after-tree",
            Self::AccessDelta => "access-delta",
        }
    }
}

/// Reads a JSON file of the repository into a value.
pub fn read_json(path: &PathBuf) -> Result<JsonValue, String> {
    let text =
        fs::read_to_string(path).map_err(|failure| format!("{}: {failure}", path.display()))?;

    serde_json::from_str(&text).map_err(|failure| format!("{}: {failure}", path.display()))
}

/// The halves of a fixture file, in run order, each with the members it wrote.
pub fn draft_fixture_halves(
    api: &str,
    file: DraftFixtureFile,
) -> Result<Vec<(Half, JsonObject)>, String> {
    let path = repository_root()
        .join("fixtures/draft/reference")
        .join(format!("{api}.{}.json", file.name()));
    let JsonValue::Object(parsed) = read_json(&path)? else {
        return Err(format!(
            "{}: a fixture file is an object keyed by half",
            path.display()
        ));
    };
    let mut halves: Vec<(Half, JsonObject)> = Vec::new();

    for (name, members) in &parsed {
        let half = Half::from_name(name)
            .ok_or_else(|| format!("{}: '{name}' is no half", path.display()))?;
        let JsonValue::Object(members) = members else {
            return Err(format!(
                "{}: the members of {name} are an object",
                path.display()
            ));
        };

        if halves
            .last()
            .is_some_and(|(last, _)| last.run_position() >= half.run_position())
        {
            return Err(format!(
                "{}: the halves are listed once each, in run order",
                path.display()
            ));
        }

        halves.push((half, members.clone()));
    }

    Ok(halves)
}

/// The draft JSON of `api` after the given fixture files, applied in order to a new draft.
pub fn draft_fixture_json(api: &str, files: &[DraftFixtureFile]) -> Result<JsonValue, String> {
    let mut draft = DraftIr::new()
        .to_json_value()
        .map_err(|failure| failure.to_string())?;

    for file in files {
        for (_, members) in draft_fixture_halves(api, *file)? {
            draft_apply(&mut draft, &members).map_err(|failure| failure.to_string())?;
        }
    }

    Ok(draft)
}

/// The typed draft of `api` after the given fixture files.
pub fn draft_fixture(api: &str, files: &[DraftFixtureFile]) -> Result<DraftIr, String> {
    let json = draft_fixture_json(api, files)?;

    DraftIr::from_json_value(&json).map_err(|failure| failure.to_string())
}
