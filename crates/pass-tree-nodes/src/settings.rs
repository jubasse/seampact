//! The api settings: conventions, lint rules and allows, packs and services, written to the output.

use indexmap::IndexMap;
use seampact_ir::{LintAllow, LintRule, LintSeverity, PackRef};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const LINT_SEVERITIES: &[LintSeverity] = &[
    LintSeverity::Disabled,
    LintSeverity::Warning,
    LintSeverity::Error,
];
/// The layer prefix of a pack.
const PACK_LAYER_PREFIX: &str = "pack:";
/// The one rule an allow holds for its node only.
const NODE_ONLY_RULE: &str = "seampact/subtree-exception";
/// The catalogues whose entries take `lint.allow`; an allow there holds for the entry only.
const ALLOWING_CATALOGUES: &[&str] = &[
    "schemes",
    "identities",
    "rights",
    "rules",
    "scopes",
    "schemas",
];
/// The schema positions of a node: an inline schema there holds its own allows.
const ROUTE_SCHEMA_POSITIONS: &[&str] = &["input", "output", "item"];
const ROUTE_FIELDS_MAPS: &[&str] = &["id", "pathParams", "query", "headers"];
const NESTED_SCHEMA_MAPS: &[&str] = &["properties", "oneOf"];
const NESTED_SCHEMA_LISTS: &[&str] = &["allOf", "oneOf"];
const NESTED_SCHEMAS: &[&str] = &["items", "additionalProperties", "contentSchema"];

/// Whether an allow is written on a tree node, which makes it hold for the subtree, or on a catalogue entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AllowOwner {
    Node,
    Entry,
}

/// Adds the allows an owner writes at a pointer.
type AddAllows<'add> = &'add mut dyn FnMut(Option<&JsonValue>, &str, AllowOwner);

pub(crate) fn tree_nodes_api_settings(
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesApiSettings"))
}

fn write_conventions(_scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    Err(not_ported_yet("writeConventions"))
}

fn lint_rules(
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<IndexMap<String, LintRule>, PassError> {
    Err(not_ported_yet("lintRules"))
}

fn lint_allows(_scope: &TreeNodesScope<'_, '_, '_>) -> Result<Vec<LintAllow>, PassError> {
    Err(not_ported_yet("lintAllows"))
}

fn add_route_position_allows(
    _settings: &JsonValue,
    _pointer: &str,
    _add: AddAllows<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addRoutePositionAllows"))
}

fn add_inline_schema_allows(
    _schema: Option<&JsonValue>,
    _pointer: &str,
    _add: AddAllows<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addInlineSchemaAllows"))
}

fn add_fields_map_allows(
    _fields: Option<&JsonValue>,
    _pointer: &str,
    _add: AddAllows<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addFieldsMapAllows"))
}

fn packs_of(_scope: &TreeNodesScope<'_, '_, '_>) -> Result<Vec<PackRef>, PassError> {
    Err(not_ported_yet("packsOf"))
}

fn write_services(_scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    Err(not_ported_yet("writeServices"))
}

fn add_nested_allows(
    _schema: Option<&JsonValue>,
    _pointer: &str,
    _add: AddAllows<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addNestedAllows"))
}
