//! The emitter of `OpenAPI` documents, ported from `packages/core/openapi`.
//!
//! [`emit_documents`] writes the documents of one api or the [`Refusal`](seampact_target::Refusal)s
//! that stop them, [`parse_emitter_options`] reads the `openapi` options of a config, and
//! [`merge_documents`] writes the merged document of a monorepo root.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod documents;
mod emitter_options;
mod error;
mod merge_documents;
mod not_ported;

pub use documents::{EmitOutcome, EmittedDocument, emit_documents};
pub use emitter_options::{
    EmitterOptions, ExtensionName, ExtensionSelection, InputSchemasOption, ParsedEmitterOptions,
    ReasonsOption, ServerOption, parse_emitter_options,
};
pub use error::OpenApiError;
pub use merge_documents::{MergeInput, MergeOptions, MergeOutcome, merge_documents};
