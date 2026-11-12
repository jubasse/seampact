//! The shared IR definitions: names, docs, origins and value sources.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    DerivationId, ExtensionKey, ExtensionPrefix, IrMap, Layer, NameRole, SchemaId, ValueSourceIn,
    integers,
};

/// A reference by id to a named object, map or union schema of the schemas catalogue (ADR 0004 section 4). An id, usually a scalar or a named format, is a `TypeUse` instead.
pub type SchemaRef = SchemaId;

/// A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1 and its amendment).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Name {
    /// The `segments` member.
    pub segments: Vec<String>,

    /// The `role` member.
    pub role: NameRole,

    /// The HTTP success or redirect status of a 'response' name; present if and only if role is 'response' (invariant ir.name.status, ADR 0004 section 13).
    #[serde(
        default,
        deserialize_with = "integers::optional_name_status",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<i64>,
}

/// Resolved documentation text.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Docs {
    /// The `summary` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    /// The `description` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// The extension slot: `{ '<prefix>': { '<key>': value } }` (ADR 0004 section 3).
pub type Extensions = IrMap<ExtensionPrefix, IrMap<ExtensionKey, JsonValue>>;

/// Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    /// Set on an element copied from another api by a relay route.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,

    /// 'api', 'shared', 'base', `pack:<name>`, 'core' for a declaration the compiler supplies (its pointer starts with its entry of formats, errors or schemas, with no side-table entry), or 'workspace' for a diagnostic on workspace.yaml (no IR element carries it). Closed: the one exception to open enums (ADR 0004 section 13).
    pub layer: Layer,

    /// The `pointer` member.
    pub pointer: String,
}

/// Present on, and only on, an element the compiler derived (ADR 0004 section 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedFrom {
    /// The `derivation` member.
    pub derivation: DerivationId,

    /// The `from` member.
    pub from: Vec<Origin>,
}

/// Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal, scope and holderField (the holder's property); no other member with host, subdomain and resolver; 'prefixBits' only with address (invariants ir.value-source.members and ir.value-source.place).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueSource {
    /// The `in` member.
    pub r#in: ValueSourceIn,

    /// The `name` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The `prefixBits` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_prefix_bits",
        skip_serializing_if = "Option::is_none"
    )]
    pub prefix_bits: Option<i64>,
}
