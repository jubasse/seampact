//! Consumer extension keys: each declared under a prefix with a schema and the places it may sit,
//! written `x-<prefix>-<key>` there. Every written value is parsed against its declaration's schema
//! like an example; an undeclared key, or one outside its places, is refused at the key.

use seampact_ir::{ExtensionKeyDecl, ExtensionPlace, Extensions};
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;

/// A mapping holding written extension values, and the place of the IR element they extend.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasExtensionHolder<'raw> {
    pub(crate) pointer: String,
    pub(crate) value: &'raw JsonObject,
    /// `None` for a schema mapping that writes no IR element (an inlined scalar, array or enum
    /// use).
    pub(crate) place: Option<ExtensionPlace>,
}

/// Where the written values are read: the merged raw tree and the nodes of its surfaces.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TreeSchemasExtensionSite<'tree, 'raw> {
    pub(crate) merged: &'raw JsonObject,
    pub(crate) nodes: &'tree TreeNodes<'raw>,
}

/// ECMAScript source of `x-<prefix>-<key>`: the prefix holds no dash, so the key is everything after
/// it.
const EXTENSION_KEY: &str = r"^x-([a-z][a-z0-9]*)-(.+)$";

/// The places an extension key may be declared for.
const PLACES: [ExtensionPlace; 7] = [
    ExtensionPlace::Api,
    ExtensionPlace::Operation,
    ExtensionPlace::Schema,
    ExtensionPlace::Property,
    ExtensionPlace::Right,
    ExtensionPlace::Rule,
    ExtensionPlace::Scope,
];

fn is_place(value: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isPlace"))
}

/// Whether a mapping writes any extension key.
pub(crate) fn tree_schemas_has_extensions(value: &JsonObject) -> Result<bool, PassError> {
    Err(not_ported_yet("treeSchemasHasExtensions"))
}

/// The IR slot `{ <prefix>: { <key>: value } }` of the extension values a mapping writes, each
/// copied.
pub(crate) fn tree_schemas_extension_slot(value: &JsonObject) -> Result<Extensions, PassError> {
    Err(not_ported_yet("treeSchemasExtensionSlot"))
}

pub(crate) fn tree_schemas_compile_extension_keys(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    merged: &JsonObject,
) -> Result<Vec<ExtensionKeyDecl>, PassError> {
    Err(not_ported_yet("treeSchemasCompileExtensionKeys"))
}

fn catalogue_holders<'raw>(
    merged: &'raw JsonObject,
    nodes: &TreeNodes<'raw>,
) -> Result<Vec<TreeSchemasExtensionHolder<'raw>>, PassError> {
    Err(not_ported_yet("catalogueHolders"))
}

fn places_text(places: &[ExtensionPlace]) -> Result<String, PassError> {
    Err(not_ported_yet("placesText"))
}

pub(crate) fn tree_schemas_check_extension_values(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    declarations: &[ExtensionKeyDecl],
    site: TreeSchemasExtensionSite<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasCheckExtensionValues"))
}
