//! The input schemas an operation derives: the ids input of a `batch` op (derivation `batch.read`),
//! and the version property a body version source adds to a versioned write's input schema
//! (derivation `concurrency.version`). Both run once every route position is compiled.

use std::collections::HashSet;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, DerivationId, DerivedFrom, Direction, KnownTypeUseRef, ObjectSchema, Property,
    Schema, TypeUse,
};
use seampact_json::JsonValue;
use seampact_naming::{Role, derive_name};
use seampact_pass_tree_shared::{TreeNodesOperationName, tree_nodes_op_owner};
use seampact_pipeline::{
    ConventionReading, PassError, ResolvedConventions, TreeNode, TreeNodeKind, TreeNodes,
};

use crate::compile::TreeSchemasCompiler;
use crate::property::{TreeSchemasWrittenProperty, tree_schemas_derived_property};
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, tree_schemas_entries, tree_schemas_is_object,
    tree_schemas_member, tree_schemas_pointer, tree_schemas_source_property,
};
use crate::rule::TreeSchemasRule;
use crate::scalars::MAX_SAFE_INTEGER;

const BATCH_OP: &str = "batch";
const VERSIONED_OPS: [&str; 2] = ["update", "delete"];
/// The prefix of a body version source, `body.<property>`.
const BODY_SOURCE_PREFIX: &str = "body.";
/// The derivation of the version property a body version source adds.
const CONCURRENCY_VERSION_DERIVATION: DerivationId =
    DerivationId::from_static("concurrency.version");
const INHERIT: &str = "inherit";
/// The derivation of the ids property of a batch input.
const BATCH_READ_DERIVATION: DerivationId = DerivationId::from_static("batch.read");

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
    for (_, node) in nodes.iter() {
        let Some(operation) = names.get(&node.pointer).map(|named| &named.name) else {
            continue;
        };

        if node.kind != TreeNodeKind::Op || node.name != BATCH_OP {
            continue;
        }

        if node.settings.contains_key("input") {
            continue;
        }

        if let Some(ids) = batch_ids(compiler, nodes, node, conventions)? {
            let name = derive_name(&operation.segments, Role::Input, None)
                .map_err(|error| PassError::from(InternalError::new(error.to_string())))?;

            compiler.derived_object(vec![ids], &node.pointer, &name, &[Direction::Input])?;
        }
    }

    Ok(())
}

fn batch_ids(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    node: &TreeNode<'_>,
    conventions: &ResolvedConventions<'_>,
) -> Result<Option<Property>, PassError> {
    let collection = tree_nodes_op_owner(nodes, node)?;
    let id_type = match collection {
        Some(owner) => id_type_of(compiler, owner)?,
        None => None,
    };
    let written = match node.settings.get("maxIds") {
        Some(JsonValue::Number(number)) => Some(number.to_f64()),
        _ => None,
    };
    let convention = conventions.get("batch.maxIds")?;
    let max_ids = written.or_else(|| match &convention {
        Some(ConventionReading {
            value: JsonValue::Number(number),
            ..
        }) => Some(number.to_f64()),
        _ => None,
    });

    let (Some(id_type), Some(max_ids)) = (&id_type, max_ids) else {
        let (message, fix) = if id_type.is_none() {
            (
                "the batch op reads its records by id, and its collection has no single id parameter",
                "give the collection one id parameter, or declare the op's 'input'",
            )
        } else {
            (
                "the batch op sets no 'maxIds', and 'conventions.batch.maxIds' is not set",
                "set 'maxIds' on the op, or 'conventions.batch.maxIds'",
            )
        };

        compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::BatchIds,
            pointer: node.pointer.clone(),
            message: message.to_owned(),
            fix: fix.to_owned(),
            related: None,
        })?;

        return Ok(None);
    };
    let origin = if written.is_some() {
        compiler
            .reporter
            .origin(&tree_schemas_pointer(&node.pointer, &["maxIds"]))?
    } else {
        let Some(origin) = convention.and_then(|reading| reading.origin) else {
            return Err(PassError::from(InternalError::new(
                "conventions.batch.maxIds has no core default, so it is written".to_owned(),
            )));
        };

        origin
    };
    let max_items = integer_count(max_ids)?;
    let from = compiler.reporter.origin(&node.pointer)?;

    Ok(Some(tree_schemas_derived_property(
        TreeSchemasWrittenProperty {
            name: "ids".to_owned(),
            type_use: TypeUse::Array(ArrayTypeUse {
                items: Box::new(id_type.clone()),
                min_items: None,
                max_items: Some(max_items),
                nullable: None,
                docs: None,
                examples: None,
            }),
            optional: false,
            origin,
            derived_from: Some(DerivedFrom {
                derivation: BATCH_READ_DERIVATION,
                from: vec![from],
            }),
        },
    )))
}

/// `maxIds` as an IR count: a whole number in the safe range.
fn integer_count(number: f64) -> Result<i64, PassError> {
    let is_whole = number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER;

    if !is_whole {
        return Err(PassError::from(InternalError::new(format!(
            "tree.schemas reads the batch maxIds {number}, which is no integer of the IR"
        ))));
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "a whole number within the safe range"
    )]
    Ok(number as i64)
}

fn id_type_of(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    collection: &TreeNode<'_>,
) -> Result<Option<TypeUse>, PassError> {
    let id = collection.settings.get("id");
    let pointer = tree_schemas_pointer(&collection.pointer, &["id"]);

    if tree_schemas_is_object(id) {
        let entries = tree_schemas_entries(id);

        return Ok(match entries.as_slice() {
            [(only, _)] => compiler
                .uses
                .get(&tree_schemas_pointer(&pointer, &[only]))
                .cloned(),
            _ => None,
        });
    }

    let properties = compiler.object_properties(compiler.uses.get(&pointer))?;

    Ok(match properties {
        Some([only]) => Some(only.r#type.clone()),
        _ => None,
    })
}

/// `update` and `delete` take their resource's `concurrency`; a member route only with
/// `concurrency: inherit`.
fn version_of<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<Version<'tree, 'raw>>, PassError> {
    let owner = if node.kind == TreeNodeKind::Op {
        if VERSIONED_OPS.contains(&node.name.as_str()) {
            tree_nodes_op_owner(nodes, node)?
        } else {
            None
        }
    } else if matches!(node.settings.get("concurrency"), Some(JsonValue::String(text)) if text == INHERIT)
    {
        versioned_ancestor(nodes, node)?
    } else {
        None
    };
    let Some(owner) = owner else {
        return Ok(None);
    };
    let concurrency = owner.settings.get("concurrency");

    if !tree_schemas_is_object(concurrency) {
        return Ok(None);
    }

    let (Some(JsonValue::String(version)), Some(JsonValue::String(field))) = (
        tree_schemas_member(concurrency, "version"),
        tree_schemas_member(concurrency, "field"),
    ) else {
        return Ok(None);
    };
    let inherited = if node.kind == TreeNodeKind::Op {
        None
    } else {
        Some(tree_schemas_pointer(&node.pointer, &["concurrency"]))
    };

    Ok(Some(Version {
        property: tree_schemas_source_property(version, BODY_SOURCE_PREFIX).map(str::to_owned),
        field: field.clone(),
        owner,
        inherited,
    }))
}

fn versioned_ancestor<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<&'tree TreeNode<'raw>>, PassError> {
    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;

        if tree_schemas_is_object(current.settings.get("concurrency")) {
            return Ok(Some(current));
        }

        at = current.parent;
    }

    Ok(None)
}

/// Adds the version property of a body version source to the input schema of each versioned write,
/// after its authored properties. An input schema shared by routes that do not agree on that property
/// is refused.
pub(crate) fn tree_schemas_compile_version_properties(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
) -> Result<(), PassError> {
    let mut routes_by_schema: IndexMap<String, Vec<BodyRoute<'_, '_>>> = IndexMap::new();

    for (_, node) in nodes.iter() {
        check_version_field(compiler, node)?;
    }

    for (_, node) in nodes.iter() {
        if node.kind == TreeNodeKind::Relay || !names.contains_key(&node.pointer) {
            continue;
        }

        let pointer = tree_schemas_pointer(&node.pointer, &["input"]);
        let version = version_of(nodes, node)?;
        let Some(schema_use) = compiler.uses.get(&pointer) else {
            continue;
        };
        let target = match KnownTypeUseRef::try_from(schema_use)? {
            KnownTypeUseRef::Ref(reference)
                if compiler.object_properties(Some(schema_use))?.is_some() =>
            {
                Some(reference.schema.as_str().to_owned())
            }
            _ => None,
        };

        let Some(schema) = target else {
            if version
                .as_ref()
                .is_some_and(|written| written.property.is_some())
            {
                refuse_non_object_input(compiler, &pointer)?;
            }

            continue;
        };

        routes_by_schema
            .entry(schema)
            .or_default()
            .push(BodyRoute { pointer, version });
    }

    for (schema, routes) in &routes_by_schema {
        add_version_property(compiler, schema, routes)?;
    }

    Ok(())
}

fn refuse_non_object_input(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    pointer: &str,
) -> Result<(), PassError> {
    compiler.reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::ConcurrencyVersion,
        pointer: pointer.to_owned(),
        message:
            "a body version source adds its property to the input, which is not an object schema"
                .to_owned(),
        fix: "make the input an object schema, or read the version from the query or a header"
            .to_owned(),
        related: None,
    })
}

fn add_version_property(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<(), PassError> {
    let versioned = routes.iter().find(|route| {
        route
            .version
            .as_ref()
            .is_some_and(|version| version.property.is_some())
    });
    let Some((versioned, version)) =
        versioned.and_then(|route| Some((route, route.version.as_ref()?)))
    else {
        return Ok(());
    };
    let Some(property) = &version.property else {
        return Ok(());
    };
    let other = routes.iter().find(|route| {
        route
            .version
            .as_ref()
            .map(|each| (&each.property, &each.field))
            != Some((&version.property, &version.field))
    });

    if let Some(other) = other {
        return compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::ConcurrencyVersion,
            pointer: versioned.pointer.clone(),
            message: format!(
                "the input schema '{schema}' is used by a route that adds '{property}' to it and by one that does not add the same"
            ),
            fix: "declare two schemas, one for each route".to_owned(),
            related: Some(vec![TreeSchemasRelated {
                pointer: other.pointer.clone(),
                message: format!("this route uses '{schema}' too"),
            }]),
        });
    }

    if let Some(shared_at) = use_outside_inputs(compiler, schema, routes)? {
        return compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::ConcurrencyVersion,
            pointer: versioned.pointer.clone(),
            message: format!(
                "the input schema '{schema}' is used outside the inputs of its versioned routes, which would all take '{property}'"
            ),
            fix: "declare a schema for the input of the versioned routes alone".to_owned(),
            related: Some(vec![TreeSchemasRelated {
                pointer: shared_at,
                message: format!("'{schema}' is used here too"),
            }]),
        });
    }

    let declared = collected_object_mut(compiler, schema)?
        .properties
        .iter()
        .any(|candidate| candidate.name == *property);

    if declared {
        return compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::ConcurrencyVersion,
            pointer: versioned.pointer.clone(),
            message: format!(
                "the input schema '{schema}' declares '{property}', which 'concurrency' adds"
            ),
            fix: "remove it; 'concurrency' adds it".to_owned(),
            related: None,
        });
    }

    let Some(version_type) = field_type(compiler, version)? else {
        return Ok(());
    };
    let origin = compiler.reporter.origin(&tree_schemas_pointer(
        &version.owner.pointer,
        &["concurrency", "version"],
    ))?;
    let mut from = vec![origin.clone()];

    for inherited in routes
        .iter()
        .filter_map(|route| route.version.as_ref()?.inherited.as_deref())
    {
        from.push(compiler.reporter.origin(inherited)?);
    }

    let added = tree_schemas_derived_property(TreeSchemasWrittenProperty {
        name: property.clone(),
        type_use: version_type,
        optional: false,
        origin,
        derived_from: Some(DerivedFrom {
            derivation: CONCURRENCY_VERSION_DERIVATION,
            from,
        }),
    });

    collected_object_mut(compiler, schema)?
        .properties
        .push(added);

    Ok(())
}

/// The object schema a versioned input was collected under: any other kind is a bug.
fn collected_object_mut<'compiler>(
    compiler: &'compiler mut TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
) -> Result<&'compiler mut ObjectSchema, PassError> {
    match compiler.schemas.get_mut(schema) {
        Some(Schema::Object(object)) => Ok(object),
        _ => Err(InternalError::new(format!(
            "tree.schemas collected '{schema}' as no object input"
        ))
        .into()),
    }
}

fn use_outside_inputs(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<Option<String>, PassError> {
    let mut own: HashSet<String> = routes.iter().map(|route| route.pointer.clone()).collect();

    own.insert(tree_schemas_pointer("/schemas", &[schema]));

    for (pointer, schema_use) in &compiler.uses {
        if !own.contains(pointer)
            && refers_to_schema(&encoded(serde_json::to_value(schema_use))?, schema)
        {
            return Ok(Some(pointer.clone()));
        }
    }

    for (id, written) in &compiler.schemas {
        if refers_to_schema(&encoded(serde_json::to_value(written))?, schema) {
            return Ok(Some(
                compiler
                    .written_at
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| tree_schemas_pointer("/schemas", &[id])),
            ));
        }
    }

    Ok(None)
}

/// An IR value as the JSON the walk of `refers_to_schema` reads.
pub(crate) fn encoded(
    value: serde_json::Result<serde_json::Value>,
) -> Result<JsonValue, PassError> {
    let value = value.map_err(|failure| {
        PassError::from(InternalError::new(format!(
            "tree.schemas cannot encode an IR value: {failure}"
        )))
    })?;

    JsonValue::try_from(value).map_err(|failure| {
        PassError::from(InternalError::new(format!(
            "tree.schemas holds an IR value that is no JSON value: {failure}"
        )))
    })
}

fn refers_to_schema(value: &JsonValue, schema: &str) -> bool {
    match value {
        JsonValue::Array(entries) => entries.iter().any(|entry| refers_to_schema(entry, schema)),
        JsonValue::Object(members) => {
            matches!(members.get("schema"), Some(JsonValue::String(named)) if named == schema)
                || members
                    .values()
                    .any(|entry| refers_to_schema(entry, schema))
        }
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => false,
    }
}

/// The item of a `concurrency` owner has the property `field`, whatever the version source.
fn check_version_field(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
) -> Result<(), PassError> {
    let concurrency = owner.settings.get("concurrency");
    let Some(JsonValue::String(field)) = tree_schemas_member(concurrency, "field") else {
        return Ok(());
    };
    let item_pointer = tree_schemas_pointer(&owner.pointer, &["item"]);

    // A written item that did not compile is reported where it is written.
    if owner.settings.contains_key("item") && !compiler.uses.contains_key(&item_pointer) {
        return Ok(());
    }

    if item_property(compiler, owner, field)?.is_some() {
        return Ok(());
    }

    compiler.reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::ConcurrencyField,
        pointer: tree_schemas_pointer(&owner.pointer, &["concurrency", "field"]),
        message: format!("the item has no property '{field}' to compare the version with"),
        fix: "name a property of the item schema in 'field'".to_owned(),
        related: None,
    })
}

fn item_property<'compiler>(
    compiler: &'compiler TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
    field: &str,
) -> Result<Option<&'compiler Property>, PassError> {
    let item = compiler
        .uses
        .get(&tree_schemas_pointer(&owner.pointer, &["item"]));
    let properties = compiler.object_properties(item)?;

    Ok(properties
        .and_then(|candidates| candidates.iter().find(|candidate| candidate.name == field)))
}

fn field_type(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    version: &Version<'_, '_>,
) -> Result<Option<TypeUse>, PassError> {
    let field = item_property(compiler, version.owner, &version.field)?;

    Ok(field.map(|property| property.r#type.clone()))
}
