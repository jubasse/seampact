//! The editor schemas, ported from `packages/core/cli/src/editor-schemas`: the declarations an api
//! names ([`editor_declarations`]) and the schema files [`write_editor_schemas`] writes.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod editor_names;
mod error;
mod not_ported;
mod write_editor_schemas;

use seampact_diagnostics::RuleId;

pub use editor_names::{EditorDeclaration, editor_declarations};
pub use error::EditorSchemasError;
pub use write_editor_schemas::{EditorSchemaFile, EditorSchemasPlan, write_editor_schemas};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
