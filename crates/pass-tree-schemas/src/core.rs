//! The core schemas: the params schema of each default code that carries data, the schema of one
//! schema issue and the empty body schema, seeded from the role data with origin `core` and no
//! `derivedFrom`. Their ids are reserved.

use seampact_ir::{Direction, ObjectSchema, Origin, Property, SchemaId, TypeUse};
use seampact_naming::Name;
use seampact_pipeline::{DerivationRole, PassError};

use crate::code_params::TreeSchemasCodeParamsDeclarations;
use crate::not_ported::not_ported_yet;

/// A reserved schema id: the core schema seeded under it, or the layer params that take it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasReservation {
    pub(crate) id: SchemaId,
    pub(crate) name: Name,
    /// What the id is reserved for, as a diagnostic names it.
    pub(crate) purpose: String,
    /// The layer pointer that may take the id; its core pointer when the core schema is seeded.
    pub(crate) pointer: String,
    /// The core schema; `None` when a layer's params take the id.
    pub(crate) seed: Option<ObjectSchema>,
    /// Whether a layer declaration or hoist may take the id, replacing the seed.
    pub(crate) yields: bool,
}

fn schema_invalid_code() -> Result<String, PassError> {
    Err(not_ported_yet("schemaInvalidCode"))
}

fn core_origin(pointer: &str) -> Result<Origin, PassError> {
    Err(not_ported_yet("coreOrigin"))
}

fn core_property(
    name: &str,
    type_use: TypeUse,
    optional: bool,
    pointer: &str,
) -> Result<Property, PassError> {
    Err(not_ported_yet("coreProperty"))
}

fn core_object(
    id: &SchemaId,
    name: &Name,
    direction: Direction,
    pointer: &str,
    properties: Vec<Property>,
) -> Result<ObjectSchema, PassError> {
    Err(not_ported_yet("coreObject"))
}

fn params_reservation(
    code_params: &TreeSchemasCodeParamsDeclarations<'_>,
    role: &DerivationRole,
    rate_limit_param: Option<&str>,
) -> Result<TreeSchemasReservation, PassError> {
    Err(not_ported_yet("paramsReservation"))
}

fn issue_reservation(code: &str, yields: bool) -> Result<TreeSchemasReservation, PassError> {
    Err(not_ported_yet("issueReservation"))
}

fn empty_body_reservation() -> Result<TreeSchemasReservation, PassError> {
    Err(not_ported_yet("emptyBodyReservation"))
}

/// Every reservation of the api, in the order the compiler seeds them.
pub(crate) fn tree_schemas_core_reservations(
    code_params: &TreeSchemasCodeParamsDeclarations<'_>,
    rate_limit_param: Option<&str>,
) -> Result<Vec<TreeSchemasReservation>, PassError> {
    Err(not_ported_yet("treeSchemasCoreReservations"))
}
