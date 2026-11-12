//! The compiler side of the oracle: what a subject answers for a fixture and a pass half.

use seampact_json::JsonValue;

use crate::{Fixture, RuleIdRegistry};

/// A subject's answer: the output, that the stage producing it is not ported yet, or that it failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubjectAnswer<Output> {
    /// The subject produced the output; the oracle compares it.
    Ported(Output),
    /// The subject cannot produce the output yet; the oracle skips it and never fails on it.
    NotPorted,
    /// The subject broke on an input it should handle; the run fails and the verdict names the
    /// fixture, the api and the half.
    InternalError {
        /// What failed, as the subject reports it.
        message: String,
    },
}

/// What compiling one api gave: the bytes the IR writer emits, when it emitted them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledApi {
    /// The api name, the `<api>` of `ir/<api>.json`.
    pub api: String,
    /// The text of `ir/<api>.json`, absent when the compile wrote no IR.
    pub ir: Option<String>,
    /// The text of `source-map/<api>.json`, absent when the compile wrote no source map.
    pub source_map: Option<String>,
}

/// What compiling one fixture gave.
#[derive(Debug, Clone, PartialEq)]
pub struct Compilation {
    /// The value of `diagnostics.json`:
    /// `{ "workspace": [...], "apis": [{ "api", "diagnostics": [...] }] }`.
    pub diagnostics: JsonValue,
    /// The IR and source map of each api, in the order the compiler returns them.
    pub apis: Vec<CompiledApi>,
}

/// The expected delta one pass half wrote, read from `halves/<api>/<NN>-<half>.json`.
#[derive(Debug, Clone, PartialEq)]
pub struct ExpectedDelta {
    /// The half, the `<half>` of the file name.
    pub half: String,
    /// The members the half wrote, in the convention of
    /// `packages/core/compiler/src/pipeline/draft-fixture.ts`.
    pub delta: JsonValue,
}

/// The expected deltas of one api of the fixture, in run order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ApiDeltas<'input> {
    /// The api name.
    pub api: &'input str,
    /// Its expected deltas, in run order.
    pub deltas: &'input [ExpectedDelta],
    /// The text of its expected `ir/<api>.json`, when the fixture has one: a half that relays
    /// the api reads its finalized IR from here.
    pub expected_ir: Option<&'input str>,
}

/// What a pass half starts from, read from the expected halves rather than from the subject's
/// own earlier halves, so one half is checked alone.
#[derive(Debug, Clone, PartialEq)]
pub struct HalfInput<'input> {
    /// The expected deltas of the halves before this one in the same api, in run order: applied
    /// to a new draft they give the draft the half starts from; the last is the half before it.
    pub deltas_before: &'input [ExpectedDelta],
    /// The expected deltas of every other api of the fixture that has expected halves, in file
    /// name order: the subject takes the apis this one relays, by its own relay order.
    pub other_apis: Vec<ApiDeltas<'input>>,
}

/// The compiler the oracle checks.
///
/// `cargo xtask oracle` plugs one in; every answer may be [`SubjectAnswer::NotPorted`] while its
/// stage is not ported.
pub trait OracleSubject {
    /// Compiles `fixture` from its entry file.
    ///
    /// The subject resolves no workspace imports: like `scripts/oracle/compiler.ts`, the oracle
    /// names every fixture with `workspace.imports` in `excluded.json`.
    fn compile(&self, fixture: &Fixture) -> SubjectAnswer<Compilation>;

    /// Runs one pass half of `api` in `fixture` and gives the delta it wrote, in the convention of
    /// `packages/core/compiler/src/pipeline/draft-fixture.ts`.
    ///
    /// `input` holds the expected deltas the half starts from: those of the halves before it in
    /// `api`, and those of the other apis, the relayed ones among them. As for `compile`, no
    /// workspace import is resolved.
    fn run_half(
        &self,
        fixture: &Fixture,
        api: &str,
        half: &str,
        input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue>;

    /// The rule ids each ported stage declares, and whether every stage is ported.
    fn rule_id_registry(&self) -> RuleIdRegistry;
}
