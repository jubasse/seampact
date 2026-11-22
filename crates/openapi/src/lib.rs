//! The emitter of OpenAPI documents, ported from `packages/core/openapi`.
//!
//! [`emit_documents`] writes the documents of one api or the [`Refusal`](seampact_target::Refusal)s
//! that stop them, [`parse_emitter_options`] reads the `openapi` options of a config, and
//! [`merge_documents`] writes the merged document of a monorepo root, and [`find_document_drift`]
//! locates where a committed document stops matching the emitted one.

mod bodies;
mod body_slots;
mod documents;
mod drift;
mod emit_context;
mod emitter_options;
mod error;
mod errors;
mod examples;
mod ir_text;
mod json_value;
mod merge_documents;
mod merged_document;
mod operation_marks;
mod paging;
mod parameters;
mod prefix_document;
mod responses;
mod rights;
mod schemas;
mod security;
mod serialize;
mod templates;

pub use documents::{EmitOutcome, EmittedDocument, emit_documents};
pub use drift::{DocumentDrift, find_document_drift};
pub use emitter_options::{
    EmitterOptions, ExtensionName, ExtensionSelection, InputSchemasOption, ParsedEmitterOptions,
    ReasonsOption, ServerOption, parse_emitter_options,
};
pub use error::OpenApiError;
pub use merge_documents::{MergeInput, MergeOptions, MergeOutcome, merge_documents};
