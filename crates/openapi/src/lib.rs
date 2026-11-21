//! The emitter of OpenAPI documents, ported from `packages/core/openapi`.
//!
//! [`emit_documents`] writes the documents of one api or the [`Refusal`](seampact_target::Refusal)s
//! that stop them, [`parse_emitter_options`] reads the `openapi` options of a config, and
//! [`merge_documents`] writes the merged document of a monorepo root.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod bodies;
mod body_slots;
mod documents;
mod emit_context;
mod emitter_options;
mod error;
mod errors;
mod examples;
mod ir_text;
mod json_value;
mod merge_documents;
mod not_ported;
mod operation_marks;
mod paging;
mod parameters;
mod responses;
mod rights;
mod schemas;
mod security;
mod serialize;
mod templates;

pub use documents::{EmitOutcome, EmittedDocument, emit_documents};
pub use emitter_options::{
    EmitterOptions, ExtensionName, ExtensionSelection, InputSchemasOption, ParsedEmitterOptions,
    ReasonsOption, ServerOption, parse_emitter_options,
};
pub use error::OpenApiError;
pub use merge_documents::{MergeInput, MergeOptions, MergeOutcome, merge_documents};
