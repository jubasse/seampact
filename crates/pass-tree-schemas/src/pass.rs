//! The schema service every later half receives: the type uses, query wires, schemas and enums the
//! run compiled, each answer a new copy and the run's state unreachable.

use indexmap::IndexMap;
use seampact_diagnostics::Diagnostic;
use seampact_ir::{
    Direction, Enum, ExtensionKeyDecl, KnownSchemaRef, QueryWire, Scalar, Schema, SchemaId, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_operation_names;
use seampact_pipeline::{
    HalfContext, PassError, TreeSchemaExampleIssue, TreeSchemaService, TreeSchemasMembers,
    TreeSchemasOutput, pipeline_rate_limit_param, pipeline_tree_nodes,
};

use crate::code_params::{tree_schemas_code_params_declarations, tree_schemas_compile_code_params};
use crate::compile::TreeSchemasCompiler;
use crate::core::tree_schemas_core_reservations;
use crate::directions::{tree_schemas_refuse_output_unknown_keys, tree_schemas_write_directions};
use crate::enums::tree_schemas_compile_enums;
use crate::example_check::{TreeSchemasExampleChecker, tree_schemas_check_written_examples};
use crate::extensions::{
    TreeSchemasExtensionSite, tree_schemas_check_extension_values,
    tree_schemas_compile_extension_keys,
};
use crate::not_ported::not_ported_yet;
use crate::operations::{
    tree_schemas_compile_batch_inputs, tree_schemas_compile_version_properties,
};
use crate::positions::{tree_schemas_compile_declarations, tree_schemas_compile_routes};
use crate::query_wire::{tree_schemas_form_proof_routes, tree_schemas_query_wires};
use crate::raw::TreeSchemasReporter;
use crate::relays::{TreeSchemasLocalDeclarations, tree_schemas_copy_relay_declarations};

/// What the run compiled that the service answers from.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasServiceState {
    pub(crate) uses: IndexMap<String, TypeUse>,
    pub(crate) query_wires: IndexMap<String, QueryWire>,
    pub(crate) schemas: IndexMap<String, Schema>,
    pub(crate) enums: Vec<Enum>,
}

/// The schema service over the state of a run. An output answer holds no `unknownKeys`, which acts
/// on input uses only.
#[derive(Debug)]
pub(crate) struct TreeSchemasService {
    answers: IndexMap<String, TypeUse>,
    wires: IndexMap<String, QueryWire>,
    checker: TreeSchemasExampleChecker,
}

fn copied_map<Value: Clone>(entries: &IndexMap<String, Value>) -> IndexMap<String, Value> {
    entries.clone()
}

pub(crate) fn tree_schemas_service(state: &TreeSchemasServiceState) -> TreeSchemasService {
    TreeSchemasService {
        answers: copied_map(&state.uses),
        wires: copied_map(&state.query_wires),
        checker: TreeSchemasExampleChecker::new(
            copied_map(&state.schemas),
            enums_by_id(&state.enums),
        ),
    }
}

// An enum by id; where two share one, the last is kept, as a map has it.
fn enums_by_id(enums: &[Enum]) -> IndexMap<String, Enum> {
    enums
        .iter()
        .map(|declared| (declared.id.as_str().to_owned(), declared.clone()))
        .collect()
}

fn schema_id(schema: &Schema) -> Result<&str, PassError> {
    let id = match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => &object.id,
        KnownSchemaRef::Map(map) => &map.id,
        KnownSchemaRef::Union(union) => &union.id,
    };

    Ok(id.as_str())
}

/// What the run of `tree.schemas` answers before its diagnostics move into the context's sink.
pub(crate) struct TreeSchemasRun {
    pub(crate) output: TreeSchemasOutput,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

/// The body of `treeSchemasPass.run`: it reads the context only through a shared borrow, so the
/// reporter and the relay copies can read it side by side; the caller reports the diagnostics.
pub(crate) fn tree_schemas_run(context: &HalfContext<'_>) -> Result<TreeSchemasRun, PassError> {
    let raw = context.raw;
    let conventions = *context.conventions;
    let merged = &raw.merged;
    let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))?;
    let nodes = pipeline_tree_nodes(raw)?;
    let code_params = tree_schemas_code_params_declarations(merged, &nodes);

    compiler.reserve(&tree_schemas_core_reservations(
        &code_params,
        pipeline_rate_limit_param(conventions)?,
    )?)?;
    compiler.compile_catalogue()?;
    tree_schemas_compile_declarations(&mut compiler, merged)?;
    tree_schemas_compile_code_params(&mut compiler, &code_params)?;

    let extension_keys = tree_schemas_compile_extension_keys(&mut compiler, merged)?;
    let operation_names = tree_nodes_operation_names(raw, conventions)?;

    tree_schemas_compile_routes(&mut compiler, &nodes, &operation_names)?;
    tree_schemas_compile_batch_inputs(&mut compiler, &nodes, &operation_names, &conventions)?;
    tree_schemas_compile_version_properties(&mut compiler, &nodes, &operation_names)?;
    compiler.finish()?;

    let declared_enums = tree_schemas_compile_enums(merged.get("enums"), &mut compiler.reporter)?;
    let relays = tree_schemas_copy_relay_declarations(
        &mut compiler,
        TreeSchemasLocalDeclarations {
            enums: &declared_enums,
            extension_keys: &extension_keys,
        },
        &nodes,
        context,
    )?;

    for schema in relays.schemas {
        compiler
            .schemas
            .insert(schema_id(&schema)?.to_owned(), schema);
    }

    let mut enums = declared_enums;

    enums.extend(relays.enums);

    let mut scalars = compiler.scalars.all(&mut compiler.reporter)?;

    scalars.extend(relays.scalars);

    tree_schemas_write_directions(&mut compiler, &mut enums, &mut scalars, &relays.uses)?;
    tree_schemas_refuse_output_unknown_keys(&mut compiler)?;
    tree_schemas_check_extension_values(
        &mut compiler,
        &extension_keys,
        TreeSchemasExtensionSite {
            merged,
            nodes: &nodes,
        },
    )?;
    tree_schemas_check_written_examples(
        &compiler.example_checks,
        &TreeSchemasExampleChecker::new(compiler.schemas.clone(), enums_by_id(&enums)),
        &mut compiler.reporter,
    )?;

    let form_proofs =
        tree_schemas_form_proof_routes(&nodes, context.inherited, merged.get("requirements"))?;
    let query_wires = tree_schemas_query_wires(&mut compiler, &conventions, &form_proofs)?;
    let members = written_members(
        &compiler.schemas,
        scalars,
        &enums,
        extension_keys.into_iter().chain(relays.extension_keys),
    );
    let state = TreeSchemasServiceState {
        uses: compiler.uses,
        query_wires,
        schemas: compiler.schemas,
        enums,
    };

    Ok(TreeSchemasRun {
        output: TreeSchemasOutput {
            members,
            service: Box::new(tree_schemas_service(&state)),
        },
        diagnostics: compiler.reporter.into_reported(),
    })
}

// The catalogues the half writes into the draft, each value a copy.
fn written_members(
    schemas: &IndexMap<String, Schema>,
    scalars: Vec<Scalar>,
    enums: &[Enum],
    extension_keys: impl Iterator<Item = ExtensionKeyDecl>,
) -> TreeSchemasMembers {
    let mut members = TreeSchemasMembers::default();

    for scalar in scalars {
        members.scalars.insert(scalar.id.clone(), scalar);
    }

    for (id, schema) in schemas {
        members
            .schemas
            .insert(SchemaId::new(id.clone()), schema.clone());
    }

    for declared in enums {
        members.enums.insert(declared.id.clone(), declared.clone());
    }

    for declared in extension_keys {
        members.extension_keys.insert(declared.id.clone(), declared);
    }

    members
}

impl TreeSchemaService for TreeSchemasService {
    fn type_use(&self, pointer: &str, direction: Direction) -> Result<Option<TypeUse>, PassError> {
        Err(not_ported_yet("treeSchemasService.typeUse"))
    }

    fn query_wire(&self, pointer: &str) -> Result<Option<QueryWire>, PassError> {
        Err(not_ported_yet("treeSchemasService.queryWire"))
    }

    fn check_example(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Err(not_ported_yet("treeSchemasService.checkExample"))
    }

    fn check_text_example(
        &self,
        text: &str,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Err(not_ported_yet("treeSchemasService.checkTextExample"))
    }
}
