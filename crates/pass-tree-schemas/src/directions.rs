//! Directions: each position use carries the direction of its kind, and a named schema, enum or named
//! format takes every direction it is reached in, through references, properties, items, map keys
//! and values, variants and JSON content schemas. `unknownKeys` acts on input uses only: one written
//! where every use is output is refused.

use indexmap::IndexMap;
use seampact_ir::{Direction, Enum, Scalar, Schema, TypeUse};
use seampact_pipeline::PassError;

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;
use crate::relays::TreeSchemasRelayCopies;

const DIRECTION_ORDER: [Direction; 2] = [Direction::Input, Direction::Output];

/// The declarations a walk reaches, by id.
#[derive(Debug)]
struct DirectionTargets<'declared> {
    schemas: &'declared mut IndexMap<String, Schema>,
    enums: &'declared mut IndexMap<String, Enum>,
    scalars: &'declared mut IndexMap<String, Scalar>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectionHolder {
    pointer: String,
    directions: Vec<Direction>,
}

/// Adds a direction in the fixed order; `false` when it was already there, which ends the walk of a
/// cycle.
fn add_direction(directions: &mut Vec<Direction>, direction: Direction) -> Result<bool, PassError> {
    Err(not_ported_yet("addDirection"))
}

fn reach(
    use_: &TypeUse,
    direction: &Direction,
    targets: &mut DirectionTargets<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reach"))
}

fn reach_schema(
    id: &str,
    direction: &Direction,
    targets: &mut DirectionTargets<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reachSchema"))
}

pub(crate) fn tree_schemas_write_directions(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    enums: &[Enum],
    relays: &TreeSchemasRelayCopies,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasWriteDirections"))
}

fn within(pointer: &str, holder: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("within"))
}

/// The directions of the nearest position or written schema holding `pointer`; none when no use
/// reaches it yet.
fn directions_at(holders: &[DirectionHolder], pointer: &str) -> Result<Vec<Direction>, PassError> {
    Err(not_ported_yet("directionsAt"))
}

pub(crate) fn tree_schemas_refuse_output_unknown_keys(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasRefuseOutputUnknownKeys"))
}
