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

pub use api_refs::{add_qualify_fix, entry_api_refs, sources_holding_refs, used_sources};
pub use app_plan::AppPlan;
pub use compile_sources::{
    CompiledApi, bundle_problem, compile_sources, no_workspace_problem, print_source_diagnostics,
    run_environment,
};
pub use contract_position::origin_position;
pub use emitted_app_document::EmittedAppDocument;
pub use entry_generation::generate_entries;
pub use entry_links::{
    links_of, order_entries, unconsumed_kind_problems, unknown_link_entry_problems,
    unprovided_kind_problems,
};
pub use error::GenerateError;
pub use framework_route_check::unread_framework_route_key_problems;
pub use generated_output::GeneratedOutput;
pub use local_bundle::LocalBundles;
pub use run_preparation::{PlanInputs, RunConfigLocation, prepare_run};
pub use source_reader::source_reader;
pub use stop::Stop;
pub use workspace_api_names::{source_entry_file, workspace_api_names};
pub use write_drift::{WriteDrift, find_write_drift};
pub use write_plan::{
    DOCUMENT_OWNER, SweptDirectory, commit_writes, committable_writes, plan_writes,
};
