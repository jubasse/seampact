//! One pass half run alone, from the expected deltas before it.

use std::cell::{OnceCell, RefCell};

use indexmap::IndexMap;
use seampact_diagnostics::{DiagnosticSink, InternalError, Severity, diagnostic_list_json};
use seampact_json::JsonValue;
use seampact_load::{FsReader, LoadOptions, LoadOutput, load_workspace};
use seampact_oracle::{
    ApiDeltas, ExpectedDelta, Fixture, HalfInput, HalfOutput, RecordedCall, SubjectAnswer,
};
use seampact_pipeline::{
    DraftIr, Half, HalfContext, LaterHalf, RelayedDrafts, TreeSchemaService, draft_apply,
    draft_delta,
};

use super::{CompileFailure, RecordedSchemaService};
use crate::orchestrator::sorted;
use crate::{HalfReaders, HalfRun, TreeSchemasRun, run_half, run_tree_schemas};

/// The number of halves an api's expected deltas must hold for another api to be relayed from.
const HALF_COUNT: usize = Half::RUN_ORDER.len();

/// How a half after `tree.schemas` is run: [`run_half`], or a fake half in tests.
type LaterHalfDispatch = fn(
    LaterHalf,
    &mut DraftIr,
    &mut HalfContext<'_>,
    &dyn TreeSchemaService,
) -> Result<HalfRun, InternalError>;

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

/// Runs `half` of `api` from the expected deltas before it and answers the delta it wrote and
/// the diagnostics it reported. A half after `tree.schemas` reads schemas from `calls`.
///
/// Every [`InternalError`] answers as a failure; only a half or a stage that is not ported
/// answers [`SubjectAnswer::NotPorted`], and the diagnostics such a half reported are dropped.
pub(super) fn run_fixture_half(
    cache: &LoadedFixtureCache,
    fixture: &Fixture,
    api: &str,
    half: &str,
    input: &HalfInput<'_>,
    calls: &[RecordedCall],
) -> Result<SubjectAnswer<HalfOutput>, CompileFailure> {
    let half = Half::from_name(half)
        .ok_or_else(|| InternalError::new(format!("'{half}' is no pass half")))?;
    let run = HalfToRun {
        api,
        half,
        input,
        calls,
        dispatch: run_half,
    };

    cache.with_loaded(fixture, |loaded| run.run(loaded))
}

/// One half of one api, with what it reads.
struct HalfToRun<'input> {
    api: &'input str,
    half: Half,
    input: &'input HalfInput<'input>,
    calls: &'input [RecordedCall],
    dispatch: LaterHalfDispatch,
}

impl HalfToRun<'_> {
    fn run(&self, loaded: &LoadOutput) -> Result<SubjectAnswer<HalfOutput>, CompileFailure> {
        let no_imports = IndexMap::new();

        if loaded
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
        {
            return Ok(SubjectAnswer::NotPorted);
        }

        let input_json = draft_json_after(self.input.deltas_before)?;
        let input_draft = DraftIr::from_json_value(&input_json)?;
        let raw = loaded
            .workspace
            .apis
            .iter()
            .find(|raw| raw.name == self.api)
            .ok_or_else(|| {
                InternalError::new(format!("the fixture has no api named {}", self.api))
            })?;

        let readers = HalfReaders::new(raw)?;
        let relayed = LazyRelayedDrafts::new(&self.input.other_apis);

        let mut output_draft = input_draft;
        let mut sink = DiagnosticSink::new();
        let ran = {
            let mut context = readers.context(&loaded.workspace, &relayed, &no_imports, &mut sink);

            self.dispatch(&mut output_draft, &mut context)?
        };

        if let Some(failure) = relayed.first_failure() {
            return Err(failure.into());
        }

        if ran == HalfRun::NotPorted {
            return Ok(SubjectAnswer::NotPorted);
        }

        let delta = draft_delta(&input_json, &output_draft.to_json_value()?)?;
        let diagnostics = sorted(sink.into_diagnostics(), &raw.locations, &loaded.files)?;

        Ok(SubjectAnswer::Ported(HalfOutput {
            delta: JsonValue::Object(delta),
            diagnostics: diagnostic_list_json(&diagnostics),
        }))
    }

    /// Runs the half: `tree.schemas` builds its own service, a later half reads the recorded one.
    fn dispatch(
        &self,
        draft: &mut DraftIr,
        context: &mut HalfContext<'_>,
    ) -> Result<HalfRun, InternalError> {
        let Some(later) = LaterHalf::of(self.half) else {
            return match run_tree_schemas(draft, context)? {
                TreeSchemasRun::Merged(_) => Ok(HalfRun::Merged),
                TreeSchemasRun::NotPorted => Ok(HalfRun::NotPorted),
            };
        };

        let service = RecordedSchemaService::new(self.calls)?;

        (self.dispatch)(later, draft, context, &service)
    }
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

/// The draft of every other api whose six expected deltas exist, by api name, built the first
/// time a half asks for it: a half asks only for an api its own api relays to, and a relay
/// target's deltas were dumped first.
struct LazyRelayedDrafts<'input> {
    other_apis: Vec<(
        &'input ApiDeltas<'input>,
        OnceCell<Result<DraftIr, InternalError>>,
    )>,
}

impl<'input> LazyRelayedDrafts<'input> {
    fn new(other_apis: &'input [ApiDeltas<'input>]) -> Self {
        Self {
            other_apis: other_apis
                .iter()
                .filter(|other| other.deltas.len() == HALF_COUNT)
                .map(|other| (other, OnceCell::new()))
                .collect(),
        }
    }

    /// The failure of the first draft a half asked for and that could not be built: the half
    /// read it as absent, so its run is a failure.
    fn first_failure(&self) -> Option<InternalError> {
        self.other_apis
            .iter()
            .find_map(|(_, built)| built.get().and_then(|draft| draft.as_ref().err().cloned()))
    }
}

impl RelayedDrafts for LazyRelayedDrafts<'_> {
    fn relayed(&self, api: &str) -> Option<&DraftIr> {
        let (other, built) = self.other_apis.iter().find(|(other, _)| other.api == api)?;

        built
            .get_or_init(|| DraftIr::from_json_value(&draft_json_after(other.deltas)?))
            .as_ref()
            .ok()
    }
}

#[cfg(test)]
mod tests {
    use camino::Utf8PathBuf;
    use seampact_diagnostics::{Diagnostic, DiagnosticLayer, DiagnosticOrigin, RuleId};
    use seampact_ir::{Direction, IrMap, TypeUse};
    use seampact_json::JsonObject;
    use seampact_pipeline::{DeriveErrorsOutput, PassError};

    use super::*;
    use crate::half_run::merge_answer;

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
    ) -> Result<SubjectAnswer<HalfOutput>, String> {
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
            &[],
        )
        .map_err(|failure| failure.to_string())
    }

    /// The pointer the fake half asks the service about; only `recorded_calls` answers it.
    const ASKED_POINTER: &str = "/schemas/Task";

    fn recorded_calls() -> Vec<RecordedCall> {
        vec![RecordedCall {
            method: "typeUse".to_owned(),
            args: vec![
                JsonValue::String(ASKED_POINTER.to_owned()),
                JsonValue::String("input".to_owned()),
            ],
            answer: Some(serde_json::from_str(r#"{"kind": "ref", "schema": "Task"}"#).unwrap()),
        }]
    }

    fn fake_diagnostic(message: String) -> Diagnostic {
        Diagnostic {
            severity: Severity::Warning,
            rule: RuleId::from_static("seampact/derive/fake"),
            message,
            fix: "none".to_owned(),
            origin: DiagnosticOrigin {
                api: Some("tasks".to_owned()),
                layer: DiagnosticLayer::Api,
                pointer: String::new(),
            },
            related: Vec::new(),
        }
    }

    /// A later half that asks the service one question and reports its answer.
    fn asking_half(
        draft: &DraftIr,
        context: &mut HalfContext<'_>,
        schemas: &dyn TreeSchemaService,
    ) -> Result<DeriveErrorsOutput, PassError> {
        let answer = schemas.type_use(ASKED_POINTER, Direction::Input)?;
        let Some(TypeUse::Ref(reference)) = answer else {
            return Err(InternalError::new("the recorded answer is no ref").into());
        };

        context.report(fake_diagnostic(format!(
            "asked {}",
            reference.schema.as_str()
        )));

        Ok(DeriveErrorsOutput {
            errors: IrMap::new(),
            natures: IrMap::new(),
            operation_errors: vec![Vec::new(); draft.operations.len()],
        })
    }

    fn asking_dispatch(
        _half: LaterHalf,
        draft: &mut DraftIr,
        context: &mut HalfContext<'_>,
        schemas: &dyn TreeSchemaService,
    ) -> Result<HalfRun, InternalError> {
        let answer = asking_half(draft, context, schemas);

        merge_answer(answer, draft, DeriveErrorsOutput::merge_into)
    }

    fn reporting_then_not_ported_dispatch(
        _half: LaterHalf,
        draft: &mut DraftIr,
        context: &mut HalfContext<'_>,
        _schemas: &dyn TreeSchemaService,
    ) -> Result<HalfRun, InternalError> {
        context.report(fake_diagnostic("partial".to_owned()));

        let answer: Result<DeriveErrorsOutput, PassError> = Err(PassError::NotPortedYet {
            function: "fakeHalf",
        });

        merge_answer(answer, draft, DeriveErrorsOutput::merge_into)
    }

    fn internal_error_dispatch(
        _half: LaterHalf,
        draft: &mut DraftIr,
        _context: &mut HalfContext<'_>,
        _schemas: &dyn TreeSchemaService,
    ) -> Result<HalfRun, InternalError> {
        let answer: Result<DeriveErrorsOutput, PassError> =
            Err(InternalError::new("the fake half broke").into());

        merge_answer(answer, draft, DeriveErrorsOutput::merge_into)
    }

    fn run_fake(
        dispatch: LaterHalfDispatch,
        calls: &[RecordedCall],
    ) -> Result<SubjectAnswer<HalfOutput>, String> {
        let input = HalfInput {
            deltas_before: &[],
            other_apis: Vec::new(),
        };
        let run = HalfToRun {
            api: "tasks",
            half: Half::DeriveErrors,
            input: &input,
            calls,
            dispatch,
        };

        LoadedFixtureCache::default()
            .with_loaded(&reference_fixture(), |loaded| run.run(loaded))
            .map_err(|failure| failure.to_string())
    }

    #[test]
    fn a_half_that_is_not_ported_answers_not_ported() {
        assert_eq!(run("tree.schemas", &[]), Ok(SubjectAnswer::NotPorted));
        assert_eq!(run("tree.nodes", &[]), Ok(SubjectAnswer::NotPorted));
    }

    #[test]
    fn a_later_half_reads_the_recorded_service_and_answers_its_diagnostics() {
        let answer = run_fake(asking_dispatch, &recorded_calls()).unwrap();
        let SubjectAnswer::Ported(output) = answer else {
            panic!("the fake half ran: {answer:?}");
        };

        assert_eq!(output.delta, JsonValue::Object(JsonObject::new()));
        assert_eq!(
            output.diagnostics,
            diagnostic_list_json(&[fake_diagnostic("asked Task".to_owned())])
        );
    }

    #[test]
    fn a_call_the_typescript_never_made_fails_the_run_naming_the_call() {
        let failure = run_fake(asking_dispatch, &[]).unwrap_err();

        assert!(
            failure.contains(r#"["typeUse",["/schemas/Task","input"]]"#),
            "{failure}"
        );
    }

    #[test]
    fn a_half_not_ported_yet_drops_what_it_reported_before() {
        assert_eq!(
            run_fake(reporting_then_not_ported_dispatch, &[]),
            Ok(SubjectAnswer::NotPorted)
        );
    }

    #[test]
    fn an_internal_error_of_a_half_fails_the_run() {
        let failure = run_fake(internal_error_dispatch, &[]).unwrap_err();

        assert!(failure.contains("the fake half broke"), "{failure}");
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

        let run_tree_schemas_of = |fixture: &Fixture| {
            run_fixture_half(&cache, fixture, "tasks", "tree.schemas", &input, &[])
        };

        assert!(run_tree_schemas_of(&reference).is_ok());
        assert!(run_tree_schemas_of(&reference).is_ok());
        assert!(
            run_tree_schemas_of(&other).is_err(),
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
