//! The run planning of `generate` and `check`: run preparation, the app plan, entry links and
//! generation, documents, writes and drift.

mod api_refs;
mod app_entry_where;
mod compile_sources;
mod contract_position;
mod drift_level;
mod emitted_app_document;
mod error;
mod generated_output;
mod in_app;
mod local_bundle;
mod not_ported;
mod refusal_problem;
mod run_preparation;
mod source_reader;
mod workspace_api_names;
mod write_drift;
mod write_plan;

pub use api_refs::{
    EntryApisOutcome, UsedSources, add_qualify_fix, entry_api_refs, resolve_entry_apis,
    sources_holding_refs, unknown_source_problems, used_sources,
};
pub use app_entry_where::app_entry_where;
pub use compile_sources::{
    CompiledApi, CompiledSources, LintInput, bundle_problem, compile_sources, no_workspace_problem,
    print_source_diagnostics, run_environment,
};
pub use contract_position::{ContractPositions, contract_position, origin_position};
pub use drift_level::strictest_level;
pub use emitted_app_document::EmittedAppDocument;
pub use error::GenerateError;
pub use generated_output::GeneratedOutput;
pub use in_app::in_app;
pub use local_bundle::{LocalBundleOutcome, LocalBundles, verify_local_bundle};
pub use refusal_problem::problem_from_refusal;
pub use run_preparation::{PlanInputs, RunConfigLocation, prepare_run};
pub use source_reader::source_reader;
pub use workspace_api_names::{
    SINGLE_API_ENTRY, WORKSPACE_ENTRY, source_entry_file, workspace_api_names,
};
pub use write_drift::{WriteDrift, find_write_drift};
pub use write_plan::{
    CommittableDocumentWrite, CommittableEntryWrite, CommittableWrites, DOCUMENT_OWNER,
    DocumentDirectoryWrite, EntryWrite, PlannedWrites, SweptDirectory, commit_writes,
    committable_writes, plan_writes,
};
