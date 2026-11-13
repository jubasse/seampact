//! The lane's oracle subset: every expected half delta of every fixture replays onto the typed draft.

use std::path::{Path, PathBuf};

use crate::support::{files_under, read_json, repository_root};
use seampact_json::JsonValue;
use seampact_pipeline::{DraftIr, draft_apply, draft_delta};

/// The directory name that holds the half deltas of an api.
const HALVES_DIRECTORY: &str = "halves";

/// One api's half files in half order.
struct ApiHalves {
    directory: PathBuf,
    files: Vec<PathBuf>,
}

fn half_files_by_api(root: &Path) -> Result<Vec<ApiHalves>, String> {
    let files = files_under(&root.join("fixtures/expected"), &|path| {
        path.extension()
            .is_some_and(|extension| extension == "json")
            && path
                .parent()
                .and_then(Path::parent)
                .and_then(Path::file_name)
                .is_some_and(|name| name == HALVES_DIRECTORY)
    })
    .map_err(|failure| failure.to_string())?;
    let mut by_api: Vec<ApiHalves> = Vec::new();

    for file in files {
        let Some(directory) = file.parent().map(Path::to_path_buf) else {
            return Err(format!("{}: no parent directory", file.display()));
        };

        match by_api.last_mut() {
            Some(last) if last.directory == directory => last.files.push(file),
            _ => by_api.push(ApiHalves {
                directory,
                files: vec![file],
            }),
        }
    }

    Ok(by_api)
}

/// Replays one api; the first step that differs is named.
fn replay(api: &ApiHalves) -> (usize, Option<String>) {
    let mut identical = 0;
    let Ok(mut state) = DraftIr::new().to_json_value() else {
        return (identical, Some("a new draft does not encode".to_owned()));
    };

    for file in &api.files {
        match replay_step(&state, file) {
            Ok(next) => {
                state = next;
                identical += 1;
            }
            Err(difference) => {
                return (identical, Some(format!("{}: {difference}", file.display())));
            }
        }
    }

    (identical, None)
}

fn replay_step(state: &JsonValue, file: &Path) -> Result<JsonValue, String> {
    let JsonValue::Object(expected) = read_json(&file.to_path_buf())? else {
        return Err("a half delta is an object".to_owned());
    };
    let mut next = state.clone();

    draft_apply(&mut next, &expected).map_err(|failure| failure.to_string())?;

    let decoded = DraftIr::from_json_value(&next).map_err(|failure| failure.to_string())?;
    let written_back = decoded
        .to_json_value()
        .map_err(|failure| failure.to_string())?;

    if written_back != next {
        return Err("the typed draft does not write back to the same value".to_owned());
    }

    let delta = draft_delta(state, &next).map_err(|failure| failure.to_string())?;

    if delta != expected {
        return Err("draft_delta of the step is not the expected file".to_owned());
    }

    Ok(next)
}

#[test]
fn every_expected_half_delta_replays_onto_the_typed_draft() -> Result<(), String> {
    let apis = half_files_by_api(&repository_root())?;
    let total: usize = apis.iter().map(|api| api.files.len()).sum();
    let mut identical = 0;
    let mut differences: Vec<String> = Vec::new();

    for api in &apis {
        let (matched, difference) = replay(api);

        identical += matched;
        differences.extend(difference);
    }

    #[expect(
        clippy::print_stdout,
        reason = "the count the lane reports; nextest shows it with --no-capture"
    )]
    {
        println!("identical {identical} of {total}");
    }
    assert!(total > 0, "no half delta found under fixtures/expected");
    assert!(
        differences.is_empty(),
        "identical {identical} of {total}; first differences: {:?}",
        differences.iter().take(5).collect::<Vec<_>>()
    );

    Ok(())
}
