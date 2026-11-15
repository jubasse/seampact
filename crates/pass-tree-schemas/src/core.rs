//! The core schemas: the params schema of each default code that carries data, the schema of one
//! schema issue and the empty body schema, seeded from the role data with origin `core` and no
//! `derivedFrom`. Their ids are reserved.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Direction, Docs, ErrorRole, Extensions, Layer, ObjectSchema, Origin, Property, SchemaId,
    TypeUse,
};
use seampact_naming::{Name, Role, split_name};
use seampact_pipeline::{
    DerivationRole, EMPTY_BODY_SCHEMA_ID, ISSUE_SCHEMA_ID, PassError, derivation_datum_always,
    derivation_issue_members, derivation_param_of_datum, derivation_params_schema_id,
    derivation_role_of, derivation_roles,
};

use crate::code_params::TreeSchemasCodeParamsDeclarations;
use crate::compile::ir_name;
use crate::property::{TreeSchemasWrittenProperty, tree_schemas_derived_property};
use crate::raw::tree_schemas_pointer;

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

// The code whose `issues` items are the issue schema.
fn schema_invalid_code() -> Result<&'static str, PassError> {
    let role = derivation_role_of(&ErrorRole::SchemaInvalid)
        .ok_or_else(|| InternalError::new("the role data has no schemaInvalid role".to_owned()))?;

    Ok(role.default_code)
}

fn core_origin(pointer: &str) -> Origin {
    Origin {
        api: None,
        layer: Layer::Core,
        pointer: pointer.to_owned(),
    }
}

fn core_property(name: &str, type_use: TypeUse, optional: bool, pointer: &str) -> Property {
    tree_schemas_derived_property(TreeSchemasWrittenProperty {
        name: name.to_owned(),
        type_use,
        optional,
        origin: core_origin(pointer),
        derived_from: None,
    })
}

fn core_object(
    id: &SchemaId,
    name: &Name,
    direction: Direction,
    pointer: &str,
    properties: Vec<Property>,
) -> Result<ObjectSchema, PassError> {
    Ok(ObjectSchema {
        properties,
        id: id.clone(),
        name: ir_name(name)?,
        type_name: None,
        // A core schema's only uses are written by later halves (error params, the proof-only
        // input), so its direction is the one those uses have.
        directions: vec![direction],
        examples: Vec::new(),
        docs: Docs::default(),
        extensions: Extensions::default(),
        origin: core_origin(pointer),
        deprecated: None,
    })
}

fn params_reservation(
    code_params: &TreeSchemasCodeParamsDeclarations<'_>,
    role: &DerivationRole,
    rate_limit_param: Option<&str>,
) -> Result<TreeSchemasReservation, PassError> {
    let code = role.default_code;
    let name = Name {
        segments: split_name(code),
        role: Role::Params,
        status: None,
    };
    let id = derivation_params_schema_id(code)?;
    let purpose = format!("the params of the default code '{code}'");

    if let Some(declared) = code_params.get(code).and_then(|declared| declared.first()) {
        return Ok(TreeSchemasReservation {
            id,
            name,
            purpose,
            pointer: declared.pointer.clone(),
            seed: None,
            yields: false,
        });
    }

    let pointer = tree_schemas_pointer("/errors", &[code, "params"]);

    // A datum the bound code need not always receive is an optional param. `rateLimited`'s delay is
    // the param `conventions.rateLimit` names, required while that convention is set.
    let properties = role
        .data
        .iter()
        .map(|datum| {
            let param = derivation_param_of_datum(&role.role, datum, rate_limit_param);

            core_property(
                param,
                datum.type_use.clone(),
                !derivation_datum_always(&role.role, datum, rate_limit_param),
                &tree_schemas_pointer(&pointer, &[param]),
            )
        })
        .collect();
    let seed = core_object(&id, &name, Direction::Output, &pointer, properties)?;

    Ok(TreeSchemasReservation {
        id,
        name,
        purpose,
        pointer,
        seed: Some(seed),
        yields: false,
    })
}

fn issue_reservation(code: &str, yields: bool) -> Result<TreeSchemasReservation, PassError> {
    let id = SchemaId::from_static(ISSUE_SCHEMA_ID);
    let name = Name {
        segments: split_name(ISSUE_SCHEMA_ID),
        role: Role::Schema,
        status: None,
    };
    let pointer = tree_schemas_pointer("/errors", &[code, "params", "issues", "items"]);
    let properties = derivation_issue_members()
        .into_iter()
        .map(|member| {
            core_property(
                member.name,
                member.type_use,
                false,
                &tree_schemas_pointer(&pointer, &["properties", member.name]),
            )
        })
        .collect();
    let seed = core_object(&id, &name, Direction::Output, &pointer, properties)?;

    Ok(TreeSchemasReservation {
        id,
        name,
        purpose: format!("one issue of the default code '{code}'"),
        pointer,
        seed: Some(seed),
        yields,
    })
}

fn empty_body_reservation() -> Result<TreeSchemasReservation, PassError> {
    let id = SchemaId::from_static(EMPTY_BODY_SCHEMA_ID);
    let name = Name {
        segments: split_name(EMPTY_BODY_SCHEMA_ID),
        role: Role::Schema,
        status: None,
    };
    let pointer = tree_schemas_pointer("/schemas", &[EMPTY_BODY_SCHEMA_ID]);
    let seed = core_object(&id, &name, Direction::Input, &pointer, Vec::new())?;

    Ok(TreeSchemasReservation {
        id,
        name,
        purpose: "the empty body of a proof-only input".to_owned(),
        pointer,
        seed: Some(seed),
        yields: false,
    })
}

/// Every reservation of the api, in the order the compiler seeds them.
pub(crate) fn tree_schemas_core_reservations(
    code_params: &TreeSchemasCodeParamsDeclarations<'_>,
    rate_limit_param: Option<&str>,
) -> Result<Vec<TreeSchemasReservation>, PassError> {
    let mut reservations = derivation_roles()
        .iter()
        .filter(|role| !role.data.is_empty())
        .map(|role| params_reservation(code_params, role, rate_limit_param))
        .collect::<Result<Vec<_>, PassError>>()?;
    let code = schema_invalid_code()?;

    reservations.push(issue_reservation(code, code_params.contains_key(code))?);
    reservations.push(empty_body_reservation()?);

    Ok(reservations)
}
