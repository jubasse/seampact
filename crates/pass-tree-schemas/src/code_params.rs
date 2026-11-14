//! The params of the error codes declared in the `errors` catalogue or on any tree node, a relay
//! included: hoisted once per code as `<Code>Params` at its first declaration.

use indexmap::IndexMap;
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{PassError, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;

/// One declaration of a code's params, at `pointer` (`.../errors/<code>/params`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasCodeParams<'raw> {
    pub(crate) pointer: String,
    pub(crate) params: &'raw JsonValue,
}

/// The params declarations of each code, in declaration order: the catalogue's first, then the
/// tree's.
pub(crate) type TreeSchemasCodeParamsDeclarations<'raw> =
    IndexMap<String, Vec<TreeSchemasCodeParams<'raw>>>;

fn add_declarations<'raw>(
    declarations: &mut TreeSchemasCodeParamsDeclarations<'raw>,
    errors: Option<&'raw JsonValue>,
    base: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("addDeclarations"))
}

/// Collects every declaration of a code's params in the merged catalogue and on the tree nodes.
pub(crate) fn tree_schemas_code_params_declarations<'raw>(
    merged: &'raw JsonObject,
    nodes: &TreeNodes<'raw>,
) -> Result<TreeSchemasCodeParamsDeclarations<'raw>, PassError> {
    Err(not_ported_yet("treeSchemasCodeParamsDeclarations"))
}

/// Hoists each code's params once and gives every declaration with equal params the same use; error
/// params are output.
pub(crate) fn tree_schemas_compile_code_params(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    declarations: &TreeSchemasCodeParamsDeclarations<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasCompileCodeParams"))
}
