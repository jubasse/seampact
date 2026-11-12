//! The source map: where each IR location was written.

use serde::{Deserialize, Serialize};

use crate::{IrMap, integers};

/// The `SourceMap` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMap {
    /// The `irRevision` member.
    #[serde(deserialize_with = "integers::positive")]
    pub ir_revision: i64,

    /// Keyed by `<layer>#<pointer>`, the serialised form of an Origin; a 'core' origin has no entry (ADR 0004 section 11).
    pub locations: IrMap<String, SourceLocation>,
}

/// A location in a source file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    /// Relative to the workspace root, with forward slashes: never absolute, no '.' or '..' segment, no backslash or ':'.
    pub file: String,

    /// The `line` member.
    #[serde(deserialize_with = "integers::positive")]
    pub line: i64,

    /// The `column` member.
    #[serde(deserialize_with = "integers::positive")]
    pub column: i64,

    /// The `endLine` member.
    #[serde(deserialize_with = "integers::positive")]
    pub end_line: i64,

    /// The `endColumn` member.
    #[serde(deserialize_with = "integers::positive")]
    pub end_column: i64,
}
