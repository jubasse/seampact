//! The input schemas an operation derives: the ids input of a `batch` op (derivation `batch.read`),
//! and the version property a body version source adds to a versioned write's input schema
//! (derivation `concurrency.version`). Both run once every route position is compiled.

use indexmap::IndexMap;
use seampact_ir::{Property, TypeUse};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::TreeNodesOperationName;
use seampact_pipeline::{PassError, ResolvedConventions, TreeNode, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;

const BATCH_OP: &str = "batch";
const VERSIONED_OPS: [&str; 2] = ["update", "delete"];
/// ECMAScript source of a body version source, `body.<property>`.
const BODY_SOURCE: &str = r"^body\.(.+)$";
const INHERIT: &str = "inherit";

/// A versioned write: where its version is read and the item property it is compared with.
#[derive(Debug, Clone)]
struct Version<'tree, 'raw> {
    /// The version property of a body source; `None` for a query or header source.
    property: Option<String>,
    field: String,
    /// The collection or single that writes `concurrency`.
    owner: &'tree TreeNode<'raw>,
    /// The route's own `concurrency: inherit`, a source of the version property too.
    inherited: Option<String>,
}

#[derive(Debug, Clone)]
struct BodyRoute<'tree, 'raw> {
    pointer: String,
    version: Option<Version<'tree, 'raw>>,
}

/// Writes the ids input of each `batch` op without a declared `input`, and its use at the op entry.
pub(crate) fn tree_schemas_compile_batch_inputs(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
    conventions: &ResolvedConventions<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasCompileBatchInputs"))
}

fn batch_ids(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    node: &TreeNode<'_>,
    conventions: &ResolvedConventions<'_>,
) -> Result<Option<Property>, PassError> {
    Err(not_ported_yet("batchIds"))
}

fn id_type_of(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    collection: &TreeNode<'_>,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("idTypeOf"))
}

fn version_of<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<Version<'tree, 'raw>>, PassError> {
    Err(not_ported_yet("versionOf"))
}

fn versioned_ancestor<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<&'tree TreeNode<'raw>>, PassError> {
    Err(not_ported_yet("versionedAncestor"))
}

/// Adds the version property of a body version source to the input schema of each versioned write,
/// after its authored properties. An input schema shared by routes that do not agree on that property
/// is refused.
pub(crate) fn tree_schemas_compile_version_properties(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasCompileVersionProperties"))
}

fn refuse_non_object_input(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    pointer: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseNonObjectInput"))
}

fn add_version_property(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<(), PassError> {
    Err(not_ported_yet("addVersionProperty"))
}

fn use_outside_inputs(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("useOutsideInputs"))
}

fn refers_to_schema(value: &JsonValue, schema: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("refersToSchema"))
}

fn check_version_field(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkVersionField"))
}

fn item_property(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
    field: &str,
) -> Result<Option<Property>, PassError> {
    Err(not_ported_yet("itemProperty"))
}

fn field_type(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    version: &Version<'_, '_>,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("fieldType"))
}
