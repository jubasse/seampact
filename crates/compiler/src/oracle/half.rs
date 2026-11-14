//! One pass half run alone, from the expected deltas before it.

use indexmap::IndexMap;
use seampact_diagnostics::{DiagnosticSink, InternalError, Severity};
use seampact_json::JsonValue;
use seampact_load::{FsReader, LoadOptions, LoadOutput, load_workspace};
use seampact_oracle::{ApiDeltas, ExpectedDelta, Fixture, HalfInput, SubjectAnswer};
use seampact_pipeline::{DraftIr, Half, draft_apply, draft_delta};
use std::cell::RefCell;

use super::CompileFailure;
use crate::{HalfReaders, HalfRun, run_half};

/// The number of halves an api's expected deltas must hold for another api to be relayed from.
const HALF_COUNT: usize = Half::RUN_ORDER.len();

/// The loaded workspace of the one fixture whose halves run now.
///
/// The oracle asks a fixture's halves together, so one load serves them all; a call for another
/// fixture replaces it.
#[derive(Debug, Default)]
pub(super) struct LoadedFixtureCache {
    current: RefCell<Option<(String, LoadOutput)>>,
}

impl LoadedFixtureCache {
    /// Calls `use_loaded` on the workspace of `fixture`, loading it only when the cache holds
    /// another fixture.
    fn with_loaded<T>(
        &self,
        fixture: &Fixture,
        use_loaded: impl FnOnce(&LoadOutput) -> Result<T, CompileFailure>,
    ) -> Result<T, CompileFailure> {
        let mut current = self.current.try_borrow_mut().map_err(|failure| {
            InternalError::new(format!("the load cache is in use: {failure}"))
        })?;

        if current
            .as_ref()
            .is_none_or(|(path, _)| *path != fixture.path)
        {
            let reader = FsReader::new(&fixture.directory)?;
            let loaded = load_workspace(&LoadOptions {
                reader: &reader,
                entry: &fixture.entry,
            })?;

            *current = Some((fixture.path.clone(), loaded));
        }

        match current.as_ref() {
            Some((_, loaded)) => use_loaded(loaded),
            None => Err(InternalError::new("the load cache is empty after a load").into()),
        }
    }
}

/// Runs `half` of `api` from the expected deltas before it and answers the delta it wrote.
///
/// Every [`InternalError`] answers as a failure; only a half or a stage that is not ported
/// answers [`SubjectAnswer::NotPorted`].
pub(super) fn run_fixture_half(
    cache: &LoadedFixtureCache,
    fixture: &Fixture,
    api: &str,
    half: &str,
    input: &HalfInput<'_>,
) -> Result<SubjectAnswer<JsonValue>, CompileFailure> {
    let half = Half::from_name(half)
        .ok_or_else(|| InternalError::new(format!("'{half}' is no pass half")))?;

    cache.with_loaded(fixture, |loaded| run_loaded_half(loaded, api, half, input))
}

fn run_loaded_half(
    loaded: &LoadOutput,
    api: &str,
    half: Half,
    input: &HalfInput<'_>,
) -> Result<SubjectAnswer<JsonValue>, CompileFailure> {
    let no_imports = IndexMap::new();

    if loaded
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
    {
        return Ok(SubjectAnswer::NotPorted);
    }

    let input_json = draft_json_after(input.deltas_before)?;
    let input_draft = DraftIr::from_json_value(&input_json)?;
    let raw = loaded
        .workspace
        .apis
        .iter()
        .find(|raw| raw.name == api)
        .ok_or_else(|| InternalError::new(format!("the fixture has no api named {api}")))?;

    // The schema service of the later halves is what the Rust `tree.schemas` builds.
    if half != Half::TreeSchemas {
        return Ok(SubjectAnswer::NotPorted);
    }

    let readers = HalfReaders::new(raw)?;
    let relayed = relayed_drafts(&input.other_apis)?;

    let mut output_draft = input_draft;
    let mut sink = DiagnosticSink::new();
    let ran = {
        let mut context = readers.context(&loaded.workspace, &relayed, &no_imports, &mut sink);

        run_half(half, &mut output_draft, &mut context)?
    };

    if ran == HalfRun::NotPorted {
        return Ok(SubjectAnswer::NotPorted);
    }

    let delta = draft_delta(&input_json, &output_draft.to_json_value()?)?;

    Ok(SubjectAnswer::Ported(JsonValue::Object(delta)))
}

/// The draft JSON after the expected deltas, applied in order to a new draft.
fn draft_json_after(deltas: &[ExpectedDelta]) -> Result<JsonValue, InternalError> {
    let mut draft = DraftIr::new().to_json_value()?;

    for expected in deltas {
        let JsonValue::Object(members) = &expected.delta else {
            return Err(InternalError::new(format!(
                "the expected delta of {} is no object",
                expected.half
            )));
        };

        draft_apply(&mut draft, members)?;
    }

    Ok(draft)
}

/// The draft of every other api whose six expected deltas exist, by api name: a half asks only
/// for an api its own api relays to, and a relay target's deltas were dumped first.
fn relayed_drafts(
    other_apis: &[ApiDeltas<'_>],
) -> Result<IndexMap<String, DraftIr>, InternalError> {
    let mut relayed = IndexMap::new();

    for other in other_apis
        .iter()
        .filter(|other| other.deltas.len() == HALF_COUNT)
    {
        let json = draft_json_after(other.deltas)?;

        relayed.insert(other.api.to_owned(), DraftIr::from_json_value(&json)?);
    }

    Ok(relayed)
}

#[cfg(test)]
mod tests {
    use camino::Utf8PathBuf;
    use seampact_json::JsonObject;

    use super::*;

    fn reference_fixture() -> Fixture {
        Fixture {
            path: "reference".to_owned(),
            directory: Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/reference"),
            entry: "workspace.yaml".to_owned(),
        }
    }

    fn delta_of(half: &str, delta: JsonValue) -> ExpectedDelta {
        ExpectedDelta {
            half: half.to_owned(),
            delta,
        }
    }

    fn run(
        half: &str,
        deltas_before: &[ExpectedDelta],
    ) -> Result<SubjectAnswer<JsonValue>, String> {
        let input = HalfInput {
            deltas_before,
            other_apis: Vec::new(),
        };

        run_fixture_half(
            &LoadedFixtureCache::default(),
            &reference_fixture(),
            "tasks",
            half,
            &input,
        )
        .map_err(|failure| failure.to_string())
    }

    #[test]
    fn a_half_that_is_not_ported_answers_not_ported() {
        assert_eq!(run("tree.schemas", &[]), Ok(SubjectAnswer::NotPorted));
    }

    #[test]
    fn a_half_after_tree_schemas_answers_not_ported_until_the_service_exists() {
        let before = [delta_of(
            "tree.schemas",
            JsonValue::Object(JsonObject::new()),
        )];

        assert_eq!(run("tree.nodes", &before), Ok(SubjectAnswer::NotPorted));
    }

    #[test]
    fn the_cache_serves_two_fixtures_in_a_row_without_leaking_the_first() {
        let cache = LoadedFixtureCache::default();
        let reference = reference_fixture();
        let other = Fixture {
            path: "other".to_owned(),
            directory: reference.directory.join("../does-not-exist"),
            entry: "workspace.yaml".to_owned(),
        };
        let input = HalfInput {
            deltas_before: &[],
            other_apis: Vec::new(),
        };

        assert!(run_fixture_half(&cache, &reference, "tasks", "tree.schemas", &input).is_ok());
        assert!(run_fixture_half(&cache, &reference, "tasks", "tree.schemas", &input).is_ok());
        assert!(
            run_fixture_half(&cache, &other, "tasks", "tree.schemas", &input).is_err(),
            "the second fixture must be loaded, not answered from the first"
        );
    }

    #[test]
    fn a_name_that_is_no_half_is_a_failure_not_a_skip() {
        let failure = run("tree.everything", &[]).expect_err("no such half");

        assert!(
            failure.contains("'tree.everything' is no pass half"),
            "{failure}"
        );
    }

    #[test]
    fn an_expected_delta_that_is_no_object_is_a_failure_not_a_skip() {
        let before = [delta_of("tree.schemas", JsonValue::Null)];
        let failure = run("tree.nodes", &before).expect_err("a delta is an object");

        assert!(
            failure.contains("the expected delta of tree.schemas is no object"),
            "{failure}"
        );
    }

    #[test]
    fn a_delta_that_sets_a_member_twice_is_a_failure_not_a_skip() {
        let api_set = delta_of(
            "tree.nodes",
            JsonValue::Object(JsonObject::from_iter([("api".to_owned(), JsonValue::Null)])),
        );

        assert!(draft_json_after(std::slice::from_ref(&api_set)).is_ok());
        assert!(draft_json_after(&[api_set.clone(), api_set]).is_err());
    }
}
