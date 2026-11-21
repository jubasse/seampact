//! Directions: each position use carries the direction of its kind, and a named schema, enum or named
//! format takes every direction it is reached in, through references, properties, items, map keys
//! and values, variants and JSON content schemas. `unknownKeys` acts on input uses only: one written
//! where every use is output is refused.

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, Enum, KnownSchemaRef, KnownTypeUseRef, Scalar, Schema, TypeUse};
use seampact_pipeline::PassError;

use crate::compile::TreeSchemasCompiler;
use crate::raw::TreeSchemasProblem;
use crate::relays::TreeSchemasRelayUse;
use crate::rule::TreeSchemasRule;

const DIRECTION_ORDER: [Direction; 2] = [Direction::Input, Direction::Output];

/// The declarations a walk reaches, by id. An enum or a named format is written in place, in the
/// list the run goes on to write; where two share an id the last one is the target, as a map keyed
/// by id has it.
#[derive(Debug)]
struct DirectionTargets<'declared> {
    schemas: &'declared mut IndexMap<String, Schema>,
    enums: &'declared mut [Enum],
    enum_positions: HashMap<String, usize>,
    scalars: &'declared mut [Scalar],
    scalar_positions: HashMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectionHolder {
    pointer: String,
    directions: Vec<Direction>,
}

#[cfg(test)]
impl DirectionHolder {
    pub(crate) fn new(pointer: &str, directions: &[Direction]) -> Self {
        Self {
            pointer: pointer.to_owned(),
            directions: directions.to_vec(),
        }
    }
}

/// Adds a direction in the fixed order; `false` when it was already there, which ends the walk of a
/// cycle.
fn add_direction(directions: &mut Vec<Direction>, direction: Direction) -> bool {
    if directions.contains(&direction) {
        return false;
    }

    directions.push(direction);
    directions.sort_by_key(|each| DIRECTION_ORDER.iter().position(|ordered| ordered == each));

    true
}

/// Follows a use with an explicit worklist: a long reference chain must not grow the call stack.
fn reach(
    use_: &TypeUse,
    direction: &Direction,
    targets: &mut DirectionTargets<'_>,
) -> Result<(), PassError> {
    let mut pending = vec![Reached::Use(Box::new(use_.clone()))];

    while let Some(item) = pending.pop() {
        match item {
            Reached::Use(schema_use) => reach_use(&schema_use, direction, targets, &mut pending)?,
            Reached::Schema(id) => reach_schema(&id, direction, targets, &mut pending)?,
        }
    }

    Ok(())
}

fn reach_use(
    use_: &TypeUse,
    direction: &Direction,
    targets: &mut DirectionTargets<'_>,
    pending: &mut Vec<Reached>,
) -> Result<(), PassError> {
    match KnownTypeUseRef::try_from(use_)? {
        KnownTypeUseRef::Ref(reference) => {
            pending.push(Reached::Schema(reference.schema.as_str().to_owned()));
        }
        KnownTypeUseRef::Enum(enum_use) => {
            let declared = targets
                .enum_positions
                .get(enum_use.r#enum.as_str())
                .and_then(|position| targets.enums.get_mut(*position));

            if let Some(declared) = declared {
                add_direction(&mut declared.directions, direction.clone());
            }
        }
        KnownTypeUseRef::Array(array) => {
            pending.push(Reached::Use(array.items.clone()));
        }
        KnownTypeUseRef::Scalar(scalar) => {
            let named = scalar
                .scalar
                .as_ref()
                .and_then(|id| targets.scalar_positions.get(id.as_str()))
                .and_then(|position| targets.scalars.get_mut(*position));

            if let Some(named) = named {
                add_direction(&mut named.directions, direction.clone());
            }

            if let Some(content) = &scalar.content {
                pending.push(Reached::Use(content.schema.clone()));
            }
        }
        KnownTypeUseRef::File(_) | KnownTypeUseRef::Opaque(_) => {}
    }

    Ok(())
}

fn reach_schema(
    id: &str,
    direction: &Direction,
    targets: &mut DirectionTargets<'_>,
    pending: &mut Vec<Reached>,
) -> Result<(), PassError> {
    let Some(schema) = targets.schemas.get_mut(id) else {
        return Ok(());
    };

    if !add_direction(schema_directions_mut(schema)?, direction.clone()) {
        return Ok(());
    }

    pending.extend(reached_by(schema)?);

    Ok(())
}

/// What a named schema reaches, in the order the walk follows: property types, the keys then the
/// values of a map, the variants of a union.
fn reached_by(schema: &Schema) -> Result<Vec<Reached>, PassError> {
    let reached = match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => object
            .properties
            .iter()
            .map(|property| Reached::Use(Box::new(property.r#type.clone())))
            .collect(),
        KnownSchemaRef::Map(map) => map
            .keys
            .iter()
            .chain([&map.values])
            .map(|schema_use| Reached::Use(Box::new(schema_use.clone())))
            .collect(),
        KnownSchemaRef::Union(union) => union
            .variants
            .iter()
            .map(|variant| Reached::Schema(variant.schema.as_str().to_owned()))
            .collect(),
    };

    Ok(reached)
}

pub(crate) fn tree_schemas_write_directions(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    enums: &mut [Enum],
    scalars: &mut [Scalar],
    relay_uses: &[TreeSchemasRelayUse],
) -> Result<(), PassError> {
    let enum_positions = positions_by_id(enums.iter().map(|declared| declared.id.as_str()));
    let scalar_positions = positions_by_id(scalars.iter().map(|scalar| scalar.id.as_str()));
    let mut targets = DirectionTargets {
        schemas: &mut compiler.schemas,
        enums,
        enum_positions,
        scalars,
        scalar_positions,
    };

    for (pointer, directions) in &compiler.position_directions {
        let Some(schema_use) = compiler.uses.get(pointer) else {
            continue;
        };

        for direction in directions {
            reach(schema_use, direction, &mut targets)?;
        }
    }

    for relay_use in relay_uses {
        reach(&relay_use.schema_use, &relay_use.direction, &mut targets)?;
    }

    Ok(())
}

fn positions_by_id<'id>(ids: impl Iterator<Item = &'id str>) -> HashMap<String, usize> {
    ids.enumerate()
        .map(|(position, id)| (id.to_owned(), position))
        .collect()
}

pub(crate) fn within(pointer: &str, holder: &str) -> bool {
    pointer == holder
        || pointer
            .strip_prefix(holder)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// The directions of the nearest position or written schema holding `pointer`; none when no use
/// reaches it yet.
pub(crate) fn directions_at<'holders>(
    holders: &'holders [DirectionHolder],
    pointer: &str,
) -> &'holders [Direction] {
    let mut nearest: Option<&DirectionHolder> = None;

    for holder in holders
        .iter()
        .filter(|holder| within(pointer, &holder.pointer))
    {
        let longer = nearest.is_none_or(|current| {
            holder.pointer.encode_utf16().count() > current.pointer.encode_utf16().count()
        });

        if longer {
            nearest = Some(holder);
        }
    }

    nearest.map_or(&[], |holder| holder.directions.as_slice())
}

pub(crate) fn tree_schemas_refuse_output_unknown_keys(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
) -> Result<(), PassError> {
    let mut holders: Vec<DirectionHolder> = compiler
        .position_directions
        .iter()
        .map(|(pointer, directions)| DirectionHolder {
            pointer: pointer.clone(),
            directions: directions.clone(),
        })
        .collect();

    for (id, pointer) in &compiler.written_at {
        let directions = match compiler.schemas.get(id) {
            Some(schema) => schema_directions(schema)?.to_vec(),
            None => Vec::new(),
        };

        holders.push(DirectionHolder {
            pointer: pointer.clone(),
            directions,
        });
    }

    for written in &compiler.written_unknown_keys {
        let own = directions_at(&holders, written);
        let directions: Vec<Direction> = if own.is_empty() {
            let mut carried = Vec::new();

            for schema_use in compiler
                .unknown_keys_uses
                .get(written)
                .into_iter()
                .flatten()
            {
                carried.extend(directions_at(&holders, schema_use).iter().cloned());
            }

            carried
        } else {
            own.to_vec()
        };

        if directions.is_empty() || directions.contains(&Direction::Input) {
            continue;
        }

        compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::UnknownKeys,
            pointer: written.clone(),
            message: "'unknownKeys' acts on input uses only, and every use here is output"
                .to_owned(),
            fix: "remove 'unknownKeys' here; an output use strips unknown keys on emit".to_owned(),
            related: None,
        })?;
    }

    Ok(())
}

/// A schema the walk reaches: a named schema's own children, owned so the walk can write.
enum Reached {
    Use(Box<TypeUse>),
    Schema(String),
}

fn schema_directions_mut(schema: &mut Schema) -> Result<&mut Vec<Direction>, PassError> {
    match schema {
        Schema::Object(object) => Ok(&mut object.directions),
        Schema::Map(map) => Ok(&mut map.directions),
        Schema::Union(union) => Ok(&mut union.directions),
        Schema::Unknown(_) => Err(InternalError::new(
            "tree.schemas reached a schema of a kind this IR revision does not know".to_owned(),
        )
        .into()),
    }
}

fn schema_directions(schema: &Schema) -> Result<&[Direction], PassError> {
    let directions = match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => &object.directions,
        KnownSchemaRef::Map(map) => &map.directions,
        KnownSchemaRef::Union(union) => &union.directions,
    };

    Ok(directions)
}
