//! The run planning of `generate` and `check`: run preparation, the app plan, entry links and
//! generation, documents, writes and drift.

mod api_refs;
mod app_entry_where;
mod app_plan;
mod compile_sources;
mod contract_position;
mod document_emission;
mod drift_level;
mod emitted_app_document;
mod entry_generation;
mod entry_links;
mod error;
mod exclusive_base_paths;
mod filter_operations;
mod framework_docs;
mod framework_route_check;
mod generated_output;
mod import_specifier_styles;
mod in_app;
mod link_set;
mod local_bundle;
mod merged_documents;
mod mounted_base_paths;
mod native_docs_document;
mod planned_document;
mod planned_entry;
mod refusal_problem;
mod run_preparation;
mod source_reader;
mod stop;
mod workspace_api_names;
mod write_drift;
mod write_plan;

pub use api_refs::{
    add_qualify_fix, entry_api_refs, resolve_entry_apis, sources_holding_refs,
    unknown_source_problems, used_sources,
};
pub use app_entry_where::app_entry_where;
pub use app_plan::{AppPlan, plan_app};
pub use compile_sources::{
    CompiledApi, CompiledSources, LintInput, bundle_problem, compile_sources, no_workspace_problem,
    print_source_diagnostics, run_environment,
};
pub use contract_position::{ContractPositions, contract_position, origin_position};
pub use document_emission::emit_app_documents;
pub use drift_level::{DEFAULT_DRIFT_CHECK_LEVEL, strictest_level};
pub use emitted_app_document::EmittedAppDocument;
pub use entry_generation::generate_entries;
pub use entry_links::{
    link_where, links_of, order_entries, paired_api, pairing_problems, unconsumed_kind_problems,
    unknown_link_entry_problems, unprovided_kind_problems,
};
pub use error::GenerateError;
pub use exclusive_base_paths::exclusive_base_path_problems;
pub use filter_operations::{OperationSelection, filter_operations, is_in_document};
pub use framework_docs::framework_docs_problems;
pub use framework_route_check::unread_framework_route_key_problems;
pub use generated_output::{GeneratedApi, GeneratedOutput};
pub use import_specifier_styles::import_specifier_styles;
pub use in_app::in_app;
pub use local_bundle::{LocalBundleOutcome, LocalBundles, verify_local_bundle};
pub use merged_documents::emit_merged_documents;
pub use mounted_base_paths::mounted_base_paths;
pub use planned_document::{PlannedDocument, document_name, plan_documents, served_ir};
pub use planned_entry::{PlannedApi, PlannedEntry};
pub use refusal_problem::problem_from_refusal;
pub use run_preparation::{PlanInputs, RunConfigLocation, prepare_run};
pub use source_reader::source_reader;
pub use stop::Stop;
pub use workspace_api_names::{
    SINGLE_API_ENTRY, WORKSPACE_ENTRY, source_entry_file, workspace_api_names,
};
pub use write_drift::{WriteDrift, find_write_drift};
pub use write_plan::{
    CommittableDocumentWrite, CommittableEntryWrite, CommittableWrites, DOCUMENT_OWNER,
    DocumentDirectoryWrite, EntryWrite, PlannedWrites, SweptDirectory, commit_writes,
    committable_writes, plan_writes,
};
