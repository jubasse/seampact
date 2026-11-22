//! The deprecation report: each operation deprecated in `after`, each operation deprecated in
//! `before` and gone from `after`, and each schema or property whose `deprecated` flag changed.

use std::collections::HashSet;

use seampact_diff_table::{DeprecationEntry, OperationDeprecationStatus, SchemaDeprecationStatus};
use seampact_ir::{ContractIr, Deprecation, KnownSchemaRef, Operation, Schema};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use crate::DiffError;
use crate::not_ported::not_ported_yet;
use crate::walk_json::pointer_join;

/// The deprecation entries of the two contracts, sorted by operation then pointer.
///
/// # Errors
///
/// [`DiffError::NotPortedYet`] until the operation entries are ported.
pub(crate) fn deprecation_report(
    before: &ContractIr,
    after: &ContractIr,
    today: &str,
) -> Result<Vec<DeprecationEntry>, DiffError> {
    let mut entries = operation_entries(before, after, today)?;

    entries.extend(schema_entries(before, after));
    entries.sort_by(|left, right| {
        cmp_utf16(operation_of(left), operation_of(right))
            .then_with(|| cmp_utf16(pointer_of(left), pointer_of(right)))
    });

    Ok(entries)
}

fn operation_of(entry: &DeprecationEntry) -> &str {
    match entry {
        DeprecationEntry::Operation { operation, .. } => operation,
        DeprecationEntry::Schema { .. } | DeprecationEntry::Property { .. } => "",
    }
}

fn pointer_of(entry: &DeprecationEntry) -> &str {
    match entry {
        DeprecationEntry::Operation { pointer, .. }
        | DeprecationEntry::Schema { pointer, .. }
        | DeprecationEntry::Property { pointer, .. } => pointer,
    }
}

fn operation_entries(
    before: &ContractIr,
    after: &ContractIr,
    today: &str,
) -> Result<Vec<DeprecationEntry>, DiffError> {
    let mut entries = Vec::new();
    let after_ids: HashSet<&str> = after
        .operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect();

    for (position, operation) in after.operations.iter().enumerate() {
        let Some(deprecation) = &operation.deprecated else {
            continue;
        };
        let previous = before
            .operations
            .iter()
            .find(|candidate| candidate.id == operation.id)
            .and_then(|candidate| candidate.deprecated.as_ref());
        let status = after_status(previous, deprecation)?;

        entries.push(operation_entry(
            operation,
            deprecation,
            &deprecated_pointer(position),
            status,
            today,
        )?);
    }

    for (position, operation) in before.operations.iter().enumerate() {
        let Some(deprecation) = &operation.deprecated else {
            continue;
        };

        if after_ids.contains(operation.id.as_str()) {
            continue;
        }

        let status = if cmp_utf16(&deprecation.sunset, today).is_le() {
            OperationDeprecationStatus::SunsetPassed
        } else {
            OperationDeprecationStatus::Removed
        };

        entries.push(operation_entry(
            operation,
            deprecation,
            &deprecated_pointer(position),
            status,
            today,
        )?);
    }

    Ok(entries)
}

fn deprecated_pointer(position: usize) -> String {
    pointer_join("", &["operations", &position.to_string(), "deprecated"])
}

/// What became of an operation deprecated in `after`.
///
/// # Errors
///
/// Not ported yet.
fn after_status(
    _previous: Option<&Deprecation>,
    _current: &Deprecation,
) -> Result<OperationDeprecationStatus, DiffError> {
    Err(not_ported_yet("afterStatus"))
}

/// The entry of one deprecated operation.
///
/// # Errors
///
/// Not ported yet.
fn operation_entry(
    _operation: &Operation,
    _deprecation: &Deprecation,
    _pointer: &str,
    _status: OperationDeprecationStatus,
    _today: &str,
) -> Result<DeprecationEntry, DiffError> {
    Err(not_ported_yet("operationEntry"))
}

fn schema_entries(before: &ContractIr, after: &ContractIr) -> Vec<DeprecationEntry> {
    let mut entries = Vec::new();

    for (id, schema) in &after.schemas {
        let Some(previous) = before.schemas.get(id.as_str()) else {
            continue;
        };
        let pointer = pointer_join("", &["schemas", id.as_str()]);

        if flag_of(previous) != flag_of(schema) {
            entries.push(DeprecationEntry::Schema {
                pointer: pointer.clone(),
                schema: id.as_str().to_owned(),
                status: status_of(flag_of(schema)),
            });
        }

        entries.extend(property_entries(id.as_str(), &pointer, previous, schema));
    }

    entries
}

fn status_of(deprecated: bool) -> SchemaDeprecationStatus {
    if deprecated {
        SchemaDeprecationStatus::Deprecated
    } else {
        SchemaDeprecationStatus::Undeprecated
    }
}

/// Whether the schema's `deprecated` member is `true`; an unknown schema kind is read as raw JSON.
fn flag_of(schema: &Schema) -> bool {
    match schema {
        Schema::Object(object) => object.deprecated == Some(true),
        Schema::Map(map) => map.deprecated == Some(true),
        Schema::Union(union) => union.deprecated == Some(true),
        Schema::Unknown(unknown) => match unknown.raw() {
            JsonValue::Object(members) => members.get("deprecated") == Some(&JsonValue::Bool(true)),
            _ => false,
        },
    }
}

fn property_entries(
    id: &str,
    pointer: &str,
    before: &Schema,
    after: &Schema,
) -> Vec<DeprecationEntry> {
    let (Ok(KnownSchemaRef::Object(before_object)), Ok(KnownSchemaRef::Object(after_object))) = (
        KnownSchemaRef::try_from(before),
        KnownSchemaRef::try_from(after),
    ) else {
        return Vec::new();
    };
    let mut entries = Vec::new();

    for (position, property) in after_object.properties.iter().enumerate() {
        let Some(previous) = before_object
            .properties
            .iter()
            .find(|candidate| candidate.name == property.name)
        else {
            continue;
        };

        if previous.deprecated == property.deprecated {
            continue;
        }

        entries.push(DeprecationEntry::Property {
            pointer: pointer_join(pointer, &["properties", &position.to_string()]),
            schema: id.to_owned(),
            property: property.name.clone(),
            status: status_of(property.deprecated),
        });
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample_ir::sample_ir;

    /// The id of the first object schema with a property, and that schema made deprecated in `ir`.
    fn deprecate_first_object_schema(ir: &mut ContractIr) -> String {
        for (id, schema) in &mut ir.schemas {
            if let Schema::Object(object) = schema
                && let Some(property) = object.properties.first_mut()
            {
                property.deprecated = true;
                object.deprecated = Some(true);

                return id.as_str().to_owned();
            }
        }

        panic!("the sample IR has no object schema with a property");
    }

    #[test]
    fn a_schema_and_a_property_that_became_deprecated_are_reported() {
        let before = sample_ir();
        let mut after = before.clone();
        let id = deprecate_first_object_schema(&mut after);
        let entries = schema_entries(&before, &after);

        assert_eq!(
            entries,
            vec![
                DeprecationEntry::Schema {
                    pointer: format!("/schemas/{id}"),
                    schema: id.clone(),
                    status: SchemaDeprecationStatus::Deprecated,
                },
                DeprecationEntry::Property {
                    pointer: format!("/schemas/{id}/properties/0"),
                    schema: id,
                    property: entries_property_name(&after),
                    status: SchemaDeprecationStatus::Deprecated,
                },
            ]
        );
        assert_eq!(schema_entries(&after, &before).len(), 2);
        assert_eq!(schema_entries(&before, &before), Vec::new());
    }

    fn entries_property_name(ir: &ContractIr) -> String {
        ir.schemas
            .iter()
            .find_map(|(_, schema)| match schema {
                Schema::Object(object) if object.deprecated == Some(true) => object
                    .properties
                    .first()
                    .map(|property| property.name.clone()),
                _ => None,
            })
            .unwrap_or_default()
    }
}
