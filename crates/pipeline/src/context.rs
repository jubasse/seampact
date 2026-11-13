//! What every half receives besides the draft (ADR 0006 section 2).

use indexmap::IndexMap;
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_diagnostics::{Diagnostic, DiagnosticSink};
use seampact_ir::{ContractIr, Origin};

use crate::draft::DraftIr;
use crate::readers::{Inherited, ResolvedConventions, pipeline_origin};

/// The drafts of the workspace apis that already ran, by api name.
pub trait RelayedDrafts {
    /// The derived draft of a workspace api that already ran (relay order); `None` for an api of
    /// no workspace or one that has not run.
    fn relayed(&self, api: &str) -> Option<&DraftIr>;
}

impl RelayedDrafts for IndexMap<String, DraftIr> {
    fn relayed(&self, api: &str) -> Option<&DraftIr> {
        self.get(api)
    }
}

/// What every half receives besides the draft.
///
/// A half clones what it stores in its draft from `raw`, `workspace`, `relayed`, `imported` or an
/// `inherited` entry: the draft never aliases what a half reads. Everything read from `raw`
/// counts, tree-node settings and written convention readings included.
pub struct HalfContext<'run> {
    /// The api's merged raw tree, its layers, origins and locations.
    pub raw: &'run RawApi,
    /// The loaded workspace.
    pub workspace: &'run RawWorkspace,
    /// The api's conventions.
    pub conventions: &'run ResolvedConventions<'run>,
    /// The api's inherited-setting reader.
    pub inherited: &'run Inherited<'run>,
    relayed: &'run dyn RelayedDrafts,
    imports: &'run IndexMap<String, ContractIr>,
    sink: &'run mut DiagnosticSink,
}

impl<'run> HalfContext<'run> {
    /// The context of one api's run. `imports` is the `imports` option, empty when there is none.
    #[must_use]
    pub fn new(
        raw: &'run RawApi,
        workspace: &'run RawWorkspace,
        conventions: &'run ResolvedConventions<'run>,
        inherited: &'run Inherited<'run>,
        relayed: &'run dyn RelayedDrafts,
        imports: &'run IndexMap<String, ContractIr>,
        sink: &'run mut DiagnosticSink,
    ) -> Self {
        Self {
            raw,
            workspace,
            conventions,
            inherited,
            relayed,
            imports,
            sink,
        }
    }

    /// The origin of a node of the merged raw tree, from `RawApi::leaf_origins` and the layers.
    #[must_use]
    pub fn origin(&self, pointer: &str) -> Option<Origin> {
        pipeline_origin(self.raw, pointer)
    }

    /// The derived draft of a workspace api that already ran, `None` for an api of no workspace
    /// or one that has not run.
    #[must_use]
    pub fn relayed(&self, api: &str) -> Option<&DraftIr> {
        self.relayed.relayed(api)
    }

    /// The IR of an imported api, when the `imports` option supplies one, in the open reader types:
    /// an IR from another compiler version may hold a variant or a value this one does not know.
    #[must_use]
    pub fn imported(&self, api: &str) -> Option<&ContractIr> {
        self.imports.get(api)
    }

    /// Reports a diagnostic.
    pub fn report(&mut self, diagnostic: Diagnostic) {
        self.sink.report(diagnostic);
    }
}
