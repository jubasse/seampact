//! The run planning of `generate` and `check`: run preparation, the app plan, entry links and
//! generation, documents, writes and drift.

mod contract_position;
mod drift_level;
mod emitted_app_document;
mod error;
mod generated_output;
mod in_app;
mod not_ported;
mod refusal_problem;
mod write_drift;
mod write_plan;

pub use contract_position::{ContractPositions, contract_position, origin_position};
pub use drift_level::strictest_level;
pub use emitted_app_document::EmittedAppDocument;
pub use error::GenerateError;
pub use generated_output::GeneratedOutput;
pub use in_app::in_app;
pub use refusal_problem::problem_from_refusal;
pub use write_drift::{WriteDrift, find_write_drift};
pub use write_plan::{
    CommittableDocumentWrite, CommittableEntryWrite, CommittableWrites, DOCUMENT_OWNER,
    DocumentDirectoryWrite, EntryWrite, PlannedWrites, SweptDirectory, committable_writes,
    plan_writes,
};
