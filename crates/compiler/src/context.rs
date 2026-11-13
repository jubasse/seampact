//! The readers and the context of one half of one api.

use indexmap::IndexMap;
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_diagnostics::{DiagnosticSink, InternalError};
use seampact_ir::ContractIr;
use seampact_pipeline::{
    HalfContext, Inherited, RelayedDrafts, ResolvedConventions, pipeline_conventions,
};

/// What every half of one api reads besides the draft: its conventions and its inherited-setting
/// reader, built once from the api's raw tree.
#[derive(Debug)]
pub struct HalfReaders<'run> {
    raw: &'run RawApi,
    conventions: ResolvedConventions<'run>,
    inherited: Inherited<'run>,
}

impl<'run> HalfReaders<'run> {
    /// The readers of `raw`.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the tree-node model of `raw` is inconsistent.
    pub fn new(raw: &'run RawApi) -> Result<Self, InternalError> {
        Ok(Self {
            raw,
            conventions: pipeline_conventions(raw),
            inherited: Inherited::new(raw)?,
        })
    }

    /// The context of one half: what it reads, and the sink its diagnostics go to.
    pub fn context<'half>(
        &'half self,
        workspace: &'half RawWorkspace,
        relayed: &'half dyn RelayedDrafts,
        imports: &'half IndexMap<String, ContractIr>,
        sink: &'half mut DiagnosticSink,
    ) -> HalfContext<'half> {
        HalfContext::new(
            self.raw,
            workspace,
            &self.conventions,
            &self.inherited,
            relayed,
            imports,
            sink,
        )
    }
}
