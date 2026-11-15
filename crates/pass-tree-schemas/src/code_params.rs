//! The params of the error codes declared in the `errors` catalogue or on any tree node, a relay
//! included: hoisted once per code as `<Code>Params` at its first declaration.

use indexmap::IndexMap;
use seampact_ir::Direction;
use seampact_json::{JsonObject, JsonValue, canonical_json};
use seampact_naming::{Name, Role, split_name};
use seampact_pipeline::{PassError, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::raw::{tree_schemas_entries, tree_schemas_member, tree_schemas_pointer};

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
) {
    for (code, error) in tree_schemas_entries(errors) {
        let Some(params) = tree_schemas_member(Some(error), "params") else {
            continue;
        };

        declarations
            .entry(code.to_owned())
            .or_default()
            .push(TreeSchemasCodeParams {
                pointer: tree_schemas_pointer(base, &[code, "params"]),
                params,
            });
    }
}

/// Collects every declaration of a code's params in the merged catalogue and on the tree nodes.
pub(crate) fn tree_schemas_code_params_declarations<'raw>(
    merged: &'raw JsonObject,
    nodes: &TreeNodes<'raw>,
) -> TreeSchemasCodeParamsDeclarations<'raw> {
    let mut declarations = IndexMap::new();

    add_declarations(&mut declarations, merged.get("errors"), "/errors");

    for (_, node) in nodes.iter() {
        add_declarations(
            &mut declarations,
            node.settings.get("errors"),
            &tree_schemas_pointer(&node.pointer, &["errors"]),
        );
    }

    declarations
}

/// Hoists each code's params once and gives every declaration with equal params the same use; error
/// params are output.
pub(crate) fn tree_schemas_compile_code_params(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    declarations: &TreeSchemasCodeParamsDeclarations<'_>,
) -> Result<(), PassError> {
    for (code, declared) in declarations {
        let Some((first, others)) = declared.split_first() else {
            continue;
        };
        let segments = split_name(code);

        if segments.is_empty() {
            continue;
        }

        let name = Name {
            segments,
            role: Role::Params,
            status: None,
        };

        compiler.fields(first.params, &first.pointer, &name, &[Direction::Output])?;
        let written = canonical_json(first.params);

        for other in others {
            if canonical_json(other.params) == written {
                compiler.share_use(&first.pointer, &other.pointer, &[Direction::Output])?;
            }
        }
    }

    Ok(())
}
