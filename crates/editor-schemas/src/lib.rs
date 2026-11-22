//! The editor schemas, ported from `packages/core/cli/src/editor-schemas`: the declarations an api
//! names ([`editor_declarations`]) and the schema files [`write_editor_schemas`] writes.

mod editor_catalogue;
mod editor_names;
mod error;
mod name_position;
mod plan_editor_schemas;
mod specialise;
mod write_editor_schemas;

use seampact_diagnostics::RuleId;

pub use editor_catalogue::EditorCatalogue;
pub use editor_names::{EditorDeclaration, EditorNames, editor_declarations, editor_names};
pub use error::EditorSchemasError;
pub use plan_editor_schemas::{
    DEFAULT_EDITOR_SCHEMAS_DIRECTORY, EditorSchemasPlanOutcome, EditorSchemasSource,
    plan_editor_schemas,
};
pub use specialise::{EditorSchemaFile, editor_schema_files};
pub use write_editor_schemas::{EditorSchemasPlan, write_editor_schemas};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
