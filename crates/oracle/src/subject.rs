//! The compiler side of the oracle: what a subject answers for a fixture and a pass half.

use seampact_json::JsonValue;

use crate::{Fixture, RuleIdRegistry};

/// A subject's answer: the output, or that the stage producing it is not ported yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubjectAnswer<Output> {
    /// The subject produced the output; the oracle compares it.
    Ported(Output),
    /// The subject cannot produce the output yet; the oracle skips it and never fails on it.
    NotPorted,
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

/// The compiler the oracle checks.
///
/// `cargo xtask oracle` plugs one in; every answer may be [`SubjectAnswer::NotPorted`] while its
/// stage is not ported.
pub trait OracleSubject {
    /// Compiles `fixture` from its entry file.
    fn compile(&self, fixture: &Fixture) -> SubjectAnswer<Compilation>;

    /// Runs one pass half of `api` in `fixture` and gives the delta it wrote, in the convention of
    /// `packages/core/compiler/src/pipeline/draft-fixture.ts`.
    ///
    /// `input` is the expected delta of the half before it for that api, `None` for the first one.
    fn run_half(
        &self,
        fixture: &Fixture,
        api: &str,
        half: &str,
        input: Option<&JsonValue>,
    ) -> SubjectAnswer<JsonValue>;

    /// The rule ids each ported stage declares, and whether every stage is ported.
    fn rule_id_registry(&self) -> RuleIdRegistry;
}
