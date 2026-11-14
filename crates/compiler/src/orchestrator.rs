//! The orchestrator: load, validate, relay order, the six halves of each api, link, finalize.
//!
//! The stop rule:
//! - load stops on an error, validate on any diagnostic: nothing after them runs;
//! - a step that reports an error completes, every error of it is reported, and no later step of
//!   that api runs; an api that relays to a stopped api (directly or not) is skipped with no
//!   diagnostic of its own; independent apis continue;
//! - link and finalize run only when no api has an error; warnings never stop anything.
//!
//! A stage that is not ported ends the run with [`PipelineRun::NotPorted`] naming it.

use std::collections::HashSet;

use indexmap::IndexMap;
use seampact_authoring::{Locations, RawApi, RawWorkspace};
use seampact_diagnostics::{Diagnostic, DiagnosticSink, InternalError, Severity, diagnostic_sort};
use seampact_ir::ContractIr;
use seampact_load::{LoadOptions, LoadOutput, load_workspace};
use seampact_pipeline::{DraftIr, Half, LaterHalf, pipeline_declared};
use seampact_span::SourceFiles;

use crate::context::HalfReaders;
use crate::half_run::{HalfRun, TreeSchemasRun, run_half, run_tree_schemas};
use crate::relay::{check_relay_order, relays_to_stopped};
use crate::result::{PipelineApiResult, PipelineResult};
use crate::stages::{
    Finalized, RelayOrder, Stage, StageAnswer, Validated, finalize_api, link_workspace,
    validate_workspace, workspace_relay_order,
};

/// What a run reads and where it starts.
pub struct PipelineOptions<'run> {
    /// The load options, handed to the load stage whole.
    pub load: LoadOptions<'run>,
    /// The IRs of imported apis by name, which a half's `imported` returns; empty without the
    /// `imports` option.
    pub imports: &'run IndexMap<String, ContractIr>,
}

/// How a run ended.
#[derive(Debug, Clone)]
pub enum PipelineRun {
    /// The run reached its end under the stop rule.
    Finished(Box<PipelineResult>),
    /// The run reached a stage that is not ported.
    NotPorted(Stage),
}

/// Compiles a workspace; see the module documentation for the stop rule.
///
/// # Errors
///
/// An [`InternalError`] from a stage, a half or a merge, or when a stage breaks its contract (a
/// relay order that misses an api, an api with no draft): a bug, never a contract fault.
pub fn compile_workspace(options: &PipelineOptions<'_>) -> Result<PipelineRun, InternalError> {
    let loaded = load_workspace(&options.load)?;
    let mut run = Run::new(loaded);

    if has_error(&run.workspace_diagnostics) {
        return run
            .finish()
            .map(|result| PipelineRun::Finished(Box::new(result)));
    }

    run.register_apis();

    let StageAnswer::Ported(validated) = validate_workspace(&run.workspace) else {
        return Ok(PipelineRun::NotPorted(Stage::Validate));
    };

    if run.apply_validation(validated)? {
        return run
            .finish()
            .map(|result| PipelineRun::Finished(Box::new(result)));
    }

    let StageAnswer::Ported(relay) = workspace_relay_order(&run.workspace) else {
        return Ok(PipelineRun::NotPorted(Stage::RelayOrder));
    };

    run.complete(&relay, options.imports)
}

fn has_error(diagnostics: &[Diagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
}

/// One api of the run: where its raw tree is, what it reported, what finalize gave.
#[derive(Debug)]
struct ApiRun {
    raw_position: usize,
    diagnostics: Vec<Diagnostic>,
    finalized: Option<Finalized>,
}

/// How far a part of the run got.
#[derive(Debug, PartialEq)]
enum Progress {
    Done,
    NotPorted(Stage),
}

/// How the six halves of one api ended.
#[derive(Debug)]
enum HalvesEnd {
    /// Every half passed: the api's derived draft.
    Complete(Box<DraftIr>),
    /// A half reported an error.
    Stopped,
    /// A half is not ported.
    NotPorted(Half),
}

/// The six halves of one api and every diagnostic they reported.
#[derive(Debug)]
struct HalvesRun {
    diagnostics: Vec<Diagnostic>,
    end: HalvesEnd,
}

/// The state of one run after load.
#[derive(Debug)]
struct Run {
    workspace: RawWorkspace,
    source_files: SourceFiles,
    read_files: Vec<String>,
    workspace_diagnostics: Vec<Diagnostic>,
    // Keyed by api name in workspace order, as a JavaScript `Map`.
    runs: IndexMap<String, ApiRun>,
    drafts: IndexMap<String, DraftIr>,
}

impl Run {
    fn new(loaded: LoadOutput) -> Self {
        Self {
            workspace: loaded.workspace,
            source_files: loaded.files,
            read_files: loaded.read_files,
            workspace_diagnostics: loaded.diagnostics,
            runs: IndexMap::new(),
            drafts: IndexMap::new(),
        }
    }

    // A name written twice keeps its first position and its last raw tree, as a `Map` built from
    // pairs.
    fn register_apis(&mut self) {
        for (raw_position, raw) in self.workspace.apis.iter().enumerate() {
            self.runs.insert(
                raw.name.clone(),
                ApiRun {
                    raw_position,
                    diagnostics: Vec::new(),
                    finalized: None,
                },
            );
        }
    }

    fn run_of(&mut self, api: &str) -> Result<&mut ApiRun, InternalError> {
        self.runs
            .get_mut(api)
            .ok_or_else(|| InternalError::new(format!("no workspace api named {api}")))
    }

    fn raw_of(&self, api: &str) -> Result<&RawApi, InternalError> {
        self.runs
            .get(api)
            .and_then(|run| self.workspace.apis.get(run.raw_position))
            .ok_or_else(|| InternalError::new(format!("no workspace api named {api}")))
    }

    // Whether validate reported anything, which stops the run.
    fn apply_validation(&mut self, validated: Validated) -> Result<bool, InternalError> {
        let reported = !validated.workspace.is_empty()
            || validated
                .apis
                .iter()
                .any(|(_, diagnostics)| !diagnostics.is_empty());

        self.workspace_diagnostics.extend(validated.workspace);

        for (api, diagnostics) in validated.apis {
            self.run_of(&api)?.diagnostics.extend(diagnostics);
        }

        Ok(reported)
    }

    // The run after validate: relay order, the halves of each api, link, finalize.
    fn complete(
        mut self,
        relay: &RelayOrder,
        imports: &IndexMap<String, ContractIr>,
    ) -> Result<PipelineRun, InternalError> {
        let workspace_apis: Vec<&str> = self.runs.keys().map(String::as_str).collect();

        check_relay_order(relay, &workspace_apis)?;

        for (api, diagnostics) in &relay.diagnostics {
            self.run_of(api)?
                .diagnostics
                .extend(diagnostics.iter().cloned());
        }

        if let Progress::NotPorted(stage) = self.run_apis(relay, imports)? {
            return Ok(PipelineRun::NotPorted(stage));
        }

        if self.clean()
            && let Progress::NotPorted(stage) = self.link(imports)?
        {
            return Ok(PipelineRun::NotPorted(stage));
        }

        if self.clean()
            && let Progress::NotPorted(stage) = self.finalize()?
        {
            return Ok(PipelineRun::NotPorted(stage));
        }

        self.finish()
            .map(|result| PipelineRun::Finished(Box::new(result)))
    }

    fn clean(&self) -> bool {
        self.runs.values().all(|run| !has_error(&run.diagnostics))
    }

    // The halves of every api in relay order; a stopped api, or one that relays to a stopped one,
    // gets no draft.
    fn run_apis(
        &mut self,
        relay: &RelayOrder,
        imports: &IndexMap<String, ContractIr>,
    ) -> Result<Progress, InternalError> {
        let mut stopped: HashSet<String> = HashSet::new();

        for api in &relay.order {
            let skipped = has_error(&self.run_of(api)?.diagnostics)
                || relays_to_stopped(api, &relay.relays_to, &stopped);

            if skipped {
                stopped.insert(api.clone());

                continue;
            }

            let halves = {
                let raw = self.raw_of(api)?;

                run_halves(raw, &self.workspace, &self.drafts, imports)?
            };

            self.run_of(api)?.diagnostics.extend(halves.diagnostics);

            match halves.end {
                HalvesEnd::NotPorted(half) => return Ok(Progress::NotPorted(Stage::Half(half))),
                HalvesEnd::Stopped => {
                    stopped.insert(api.clone());
                }
                HalvesEnd::Complete(draft) => {
                    self.drafts.insert(api.clone(), *draft);
                }
            }
        }

        Ok(Progress::Done)
    }

    // The link pass over every api's derived draft, in workspace order.
    fn link(&mut self, imports: &IndexMap<String, ContractIr>) -> Result<Progress, InternalError> {
        self.check_every_api_has_a_draft()?;

        let StageAnswer::Ported(reported) = link_workspace(&self.drafts, &self.workspace, imports)?
        else {
            return Ok(Progress::NotPorted(Stage::Link));
        };

        for (api, diagnostic) in reported {
            self.run_of(&api)?.diagnostics.push(diagnostic);
        }

        Ok(Progress::Done)
    }

    // With no error anywhere, every api ran all its halves, so every api has its draft.
    fn check_every_api_has_a_draft(&self) -> Result<(), InternalError> {
        match self.runs.keys().find(|api| !self.drafts.contains_key(*api)) {
            Some(api) => Err(InternalError::new(format!(
                "api {api} has no derived draft"
            ))),
            None => Ok(()),
        }
    }

    // Finalize of every api, each taking its draft by value.
    fn finalize(&mut self) -> Result<Progress, InternalError> {
        self.check_every_api_has_a_draft()?;

        let apis: Vec<String> = self.runs.keys().cloned().collect();

        for api in apis {
            let Some(draft) = self.drafts.shift_remove(&api) else {
                return Err(InternalError::new(format!(
                    "api {api} has no derived draft"
                )));
            };
            let answer = finalize_api(draft, self.raw_of(&api)?);
            let StageAnswer::Ported(finalized_run) = answer else {
                return Ok(Progress::NotPorted(Stage::Finalize));
            };
            let reported_error = has_error(&finalized_run.diagnostics);
            let run = self.run_of(&api)?;

            run.diagnostics.extend(finalized_run.diagnostics);

            if !reported_error {
                run.finalized = finalized_run.finalized;
            }
        }

        Ok(Progress::Done)
    }

    fn finish(self) -> Result<PipelineResult, InternalError> {
        let Self {
            workspace,
            source_files,
            read_files,
            workspace_diagnostics,
            runs,
            drafts: _,
        } = self;
        let diagnostics = sorted(workspace_diagnostics, &workspace.locations, &source_files)?;
        let mut apis = Vec::with_capacity(runs.len());

        for (api, run) in runs {
            let raw = workspace
                .apis
                .get(run.raw_position)
                .ok_or_else(|| InternalError::new(format!("no workspace api named {api}")))?;
            let (ir, source_map, declared) = match run.finalized {
                Some(finalized) => {
                    let declared = pipeline_declared(raw, &finalized.ir)?;

                    (
                        Some(finalized.ir),
                        Some(finalized.source_map),
                        Some(declared),
                    )
                }
                None => (None, None, None),
            };

            apis.push(PipelineApiResult {
                api,
                diagnostics: sorted(run.diagnostics, &raw.locations, &source_files)?,
                locations: raw.locations.clone(),
                ir,
                source_map,
                declared,
            });
        }

        Ok(PipelineResult {
            read_files,
            source_files,
            diagnostics,
            locations: workspace.locations,
            apis,
        })
    }
}

/// The diagnostics in the order users see, their spans read in `spans`.
pub(crate) fn sorted(
    diagnostics: Vec<Diagnostic>,
    spans: &Locations,
    source_files: &SourceFiles,
) -> Result<Vec<Diagnostic>, InternalError> {
    let located = source_files.locations(spans)?;

    Ok(diagnostic_sort(diagnostics, &located))
}

// The six halves of one api, each a step of the stop rule: one that reports an error completes,
// and no later half runs. Each half reports into a fresh sink, kept only when the half ran.
fn run_halves(
    raw: &RawApi,
    workspace: &RawWorkspace,
    relayed: &IndexMap<String, DraftIr>,
    imports: &IndexMap<String, ContractIr>,
) -> Result<HalvesRun, InternalError> {
    let readers = HalfReaders::new(raw)?;
    let mut draft = DraftIr::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    let mut sink = DiagnosticSink::new();
    let schemas_run = {
        let mut context = readers.context(workspace, relayed, imports, &mut sink);

        run_tree_schemas(&mut draft, &mut context)?
    };

    let TreeSchemasRun::Merged(service) = schemas_run else {
        return Ok(HalvesRun {
            diagnostics,
            end: HalvesEnd::NotPorted(Half::TreeSchemas),
        });
    };

    if keep_or_stop(sink, &mut diagnostics) == HalfStep::Stop {
        return Ok(HalvesRun {
            diagnostics,
            end: HalvesEnd::Stopped,
        });
    }

    for half in LaterHalf::RUN_ORDER {
        let mut sink = DiagnosticSink::new();
        let ran = {
            let mut context = readers.context(workspace, relayed, imports, &mut sink);

            run_half(half, &mut draft, &mut context, &*service)?
        };

        if ran == HalfRun::NotPorted {
            return Ok(HalvesRun {
                diagnostics,
                end: HalvesEnd::NotPorted(half.into()),
            });
        }

        if keep_or_stop(sink, &mut diagnostics) == HalfStep::Stop {
            return Ok(HalvesRun {
                diagnostics,
                end: HalvesEnd::Stopped,
            });
        }
    }

    Ok(HalvesRun {
        diagnostics,
        end: HalvesEnd::Complete(Box::new(draft)),
    })
}

/// Whether the next half of an api runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HalfStep {
    Continue,
    Stop,
}

// Keeps what a half that ran reported; an error stops the api.
fn keep_or_stop(sink: DiagnosticSink, diagnostics: &mut Vec<Diagnostic>) -> HalfStep {
    let reported = sink.into_diagnostics();
    let failed = has_error(&reported);

    diagnostics.extend(reported);

    if failed {
        HalfStep::Stop
    } else {
        HalfStep::Continue
    }
}

#[cfg(test)]
mod tests {
    use camino::Utf8PathBuf;
    use seampact_diagnostics::{DiagnosticLayer, DiagnosticOrigin, RuleId};
    use seampact_load::FsReader;

    use super::*;

    fn loaded_reference() -> Run {
        let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reference");
        let reader = FsReader::new(&root).expect("the reference fixture exists");
        let loaded = load_workspace(&LoadOptions {
            reader: &reader,
            entry: "workspace.yaml",
        })
        .expect("the reference loads");
        let mut run = Run::new(loaded);

        run.register_apis();

        run
    }

    fn relay_in_workspace_order(run: &Run) -> RelayOrder {
        RelayOrder {
            order: run.runs.keys().cloned().collect(),
            ..RelayOrder::default()
        }
    }

    fn error_of(api: &str) -> Diagnostic {
        Diagnostic {
            severity: Severity::Error,
            rule: RuleId::from_static("tree-test"),
            message: "broken".to_owned(),
            fix: "fix it".to_owned(),
            origin: DiagnosticOrigin {
                api: Some(api.to_owned()),
                layer: DiagnosticLayer::Api,
                pointer: String::new(),
            },
            related: Vec::new(),
        }
    }

    #[test]
    fn the_apis_keep_workspace_order() {
        let run = loaded_reference();
        let names: Vec<&str> = run.runs.keys().map(String::as_str).collect();
        let workspace_names: Vec<&str> = run
            .workspace
            .apis
            .iter()
            .map(|raw| raw.name.as_str())
            .collect();

        assert_eq!(names, workspace_names);
        assert!(names.len() > 1);
    }

    #[test]
    fn an_api_name_written_twice_keeps_its_first_place_and_its_last_tree() {
        let mut run = loaded_reference();
        let mut duplicate = run.workspace.apis[0].clone();

        duplicate.name = run.workspace.apis[1].name.clone();
        run.workspace.apis.push(duplicate);
        run.runs.clear();
        run.register_apis();

        let last = run.workspace.apis.len() - 1;

        assert_eq!(run.runs.len(), last);
        assert_eq!(
            run.runs.get_index(1).map(|(_, run)| run.raw_position),
            Some(last)
        );
    }

    #[test]
    fn an_unknown_api_is_an_internal_error_not_a_skip() {
        let mut run = loaded_reference();

        let failure = run.run_of("nowhere").expect_err("no such api");

        assert_eq!(failure.what(), "no workspace api named nowhere");
    }

    #[test]
    fn the_first_api_that_runs_a_half_ends_the_run_at_the_first_half() {
        let mut run = loaded_reference();
        let relay = relay_in_workspace_order(&run);

        let progress = run
            .run_apis(&relay, &IndexMap::new())
            .expect("no internal error");

        assert_eq!(
            progress,
            Progress::NotPorted(Stage::Half(Half::TreeSchemas))
        );
    }

    #[test]
    fn an_api_with_an_error_is_skipped_and_independent_apis_continue() {
        let mut run = loaded_reference();
        let relay = relay_in_workspace_order(&run);
        let names: Vec<String> = run.runs.keys().cloned().collect();

        for name in &names {
            run.run_of(name)
                .expect("registered")
                .diagnostics
                .push(error_of(name));
        }

        let all_skipped = run
            .run_apis(&relay, &IndexMap::new())
            .expect("no internal error");

        assert_eq!(all_skipped, Progress::Done);
        assert!(run.drafts.is_empty());

        run.run_of(&names[1])
            .expect("registered")
            .diagnostics
            .clear();

        let one_runs = run
            .run_apis(&relay, &IndexMap::new())
            .expect("no internal error");

        assert_eq!(
            one_runs,
            Progress::NotPorted(Stage::Half(Half::TreeSchemas))
        );
    }

    #[test]
    fn a_relay_that_leaves_an_api_out_is_an_internal_error() {
        let run = loaded_reference();
        let mut relay = relay_in_workspace_order(&run);

        relay.order.pop();

        let failure = run
            .complete(&relay, &IndexMap::new())
            .expect_err("the relay misses an api");

        assert!(failure.what().starts_with("the relay order must list"));
    }

    #[test]
    fn link_with_an_api_that_has_no_draft_is_an_internal_error() {
        let mut run = loaded_reference();

        let failure = run.link(&IndexMap::new()).expect_err("no api has a draft");

        assert!(failure.what().ends_with("has no derived draft"));
    }

    #[test]
    fn finish_lists_every_api_in_workspace_order_with_no_ir_before_finalize() {
        let run = loaded_reference();
        let names: Vec<String> = run.runs.keys().cloned().collect();

        let result = run.finish().expect("finish");
        let listed: Vec<String> = result.apis.iter().map(|api| api.api.clone()).collect();

        assert_eq!(listed, names);
        assert!(
            result
                .apis
                .iter()
                .all(|api| api.ir.is_none() && api.declared.is_none())
        );
    }
}
