//! What a pipeline run gives back.

use seampact_authoring::Locations;
use seampact_diagnostics::Diagnostic;
use seampact_ir::{ContractIr, SourceMap};
use seampact_pipeline::PipelineDeclared;
use seampact_span::SourceFiles;

/// The result of one api of the workspace.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineApiResult {
    /// The api name.
    pub api: String,
    /// Every diagnostic listed under the api, sorted by file, line, column and rule.
    pub diagnostics: Vec<Diagnostic>,
    /// The api's side table, which locates its diagnostics.
    pub locations: Locations,
    /// The finalized IR, when finalize produced one.
    pub ir: Option<ContractIr>,
    /// The source map of the IR, with it.
    pub source_map: Option<SourceMap>,
    /// With the IR: every catalogue entry the api's layers declare, and whether the contract
    /// reaches it.
    pub declared: Option<Vec<PipelineDeclared>>,
}

/// The result of a whole run.
#[derive(Debug, Clone)]
pub struct PipelineResult {
    /// Every file the load stage read or tried to read, sorted, for the watch primitive.
    pub read_files: Vec<String>,
    /// The normalised text of every file read: what the tables of this result point into.
    pub source_files: SourceFiles,
    /// The load stage's diagnostics and the workspace entry's, sorted.
    pub diagnostics: Vec<Diagnostic>,
    /// The workspace table, beside each api's own.
    pub locations: Locations,
    /// One entry per api in workspace order; empty when the load stage stopped.
    pub apis: Vec<PipelineApiResult>,
}
