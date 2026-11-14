//! The schema service every later half receives: the type uses, query wires, schemas and enums the
//! run compiled, each answer a new copy and the run's state unreachable.

use indexmap::IndexMap;
use seampact_ir::{Direction, Enum, QueryWire, Schema, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaExampleIssue, TreeSchemaService};

use crate::example_check::TreeSchemasExampleChecker;
use crate::not_ported::not_ported_yet;

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

fn copied_map<Value: Clone>(
    entries: &IndexMap<String, Value>,
) -> Result<IndexMap<String, Value>, PassError> {
    Err(not_ported_yet("copiedMap"))
}

pub(crate) fn tree_schemas_service(
    state: &TreeSchemasServiceState,
) -> Result<TreeSchemasService, PassError> {
    Err(not_ported_yet("treeSchemasService"))
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
