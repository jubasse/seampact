//! The query wire form of each query or form field (ADR 0002 section 7), keyed by its position in
//! the input schema, and of each rule proof schema.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    KnownSchemaRef, KnownTypeUseRef, QueryStyle, QueryWire, QueryWireKind, RefTypeUse, ScalarType,
    SchemaId, TypeUse,
};
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{
    Inherited, OrderedSetting, PassError, ResolvedConventions, TreeNodeKind, TreeNodes,
};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;
use crate::raw::{tree_schemas_member, tree_schemas_pointer};

/// How a query field is written on the wire, besides its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Encoding {
    style: QueryStyle,
    explode: bool,
    brackets: bool,
}

/// The encoding of a single value.
const SINGLE: Encoding = Encoding {
    style: QueryStyle::Form,
    explode: true,
    brackets: false,
};

/// The single kinds a list holds or a field is: a query wire kind but `list` and `object`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SingleKind {
    Text,
    Number,
    Boolean,
}

impl SingleKind {
    const fn wire_kind(self) -> QueryWireKind {
        match self {
            Self::Text => QueryWireKind::Text,
            Self::Number => QueryWireKind::Number,
            Self::Boolean => QueryWireKind::Boolean,
        }
    }
}

/// The `query.lists` conventions and the encoding each gives.
const LISTS: [(&str, Encoding); 3] = [
    ("repeat", SINGLE),
    (
        "comma",
        Encoding {
            style: QueryStyle::Form,
            explode: false,
            brackets: false,
        },
    ),
    (
        "brackets",
        Encoding {
            style: QueryStyle::Form,
            explode: true,
            brackets: true,
        },
    ),
];

/// The `query.objects` conventions and the encoding each gives.
const OBJECTS: [(&str, Encoding); 2] = [
    ("explode", SINGLE),
    (
        "deepObject",
        Encoding {
            style: QueryStyle::DeepObject,
            explode: true,
            brackets: false,
        },
    ),
];

/// The `inputMedia` words whose body names each value by a field, as a query string does.
const FIELD_MEDIA: [&str; 2] = ["form", "multipart"];

/// The node kinds a form proof route may be.
/// Which convention an encoding is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncodingConvention {
    Lists,
    Objects,
}

impl EncodingConvention {
    const fn path(self) -> &'static str {
        match self {
            Self::Lists => "query.lists",
            Self::Objects => "query.objects",
        }
    }
}

fn encoding_of(
    conventions: &ResolvedConventions<'_>,
    convention: EncodingConvention,
    table: &[(&str, Encoding)],
) -> Result<Encoding, PassError> {
    let path = convention.path();
    let reading = conventions.get(path)?;
    let value = reading.as_ref().map(|written| written.value);
    let encoding = match value {
        Some(JsonValue::String(text)) => table
            .iter()
            .find(|(name, _)| name == text)
            .map(|(_, encoding)| encoding.clone()),
        _ => None,
    };

    encoding.ok_or_else(|| {
        let shown = value.map_or_else(|| "undefined".to_owned(), shown_convention_value);

        PassError::from(InternalError::new(format!(
            "conventions.{path} is '{shown}', which validate refuses"
        )))
    })
}

// `String(value)` of a convention value.
fn shown_convention_value(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => text.clone(),
        other => stringify_json(other),
    }
}

fn single_kind(schema_use: &TypeUse) -> Result<Option<SingleKind>, PassError> {
    let kind = match KnownTypeUseRef::try_from(schema_use)? {
        KnownTypeUseRef::Enum(_) => Some(SingleKind::Text),
        KnownTypeUseRef::Scalar(scalar) => match scalar.r#type {
            ScalarType::String => Some(SingleKind::Text),
            ScalarType::Boolean => Some(SingleKind::Boolean),
            ScalarType::Integer | ScalarType::Number => Some(SingleKind::Number),
            _ => None,
        },
        KnownTypeUseRef::Ref(_)
        | KnownTypeUseRef::Opaque(_)
        | KnownTypeUseRef::File(_)
        | KnownTypeUseRef::Array(_) => None,
    };

    Ok(kind)
}

fn is_list_of_singles(schema_use: &TypeUse) -> Result<bool, PassError> {
    let KnownTypeUseRef::Array(array) = KnownTypeUseRef::try_from(schema_use)? else {
        return Ok(false);
    };

    Ok(single_kind(&array.items)?.is_some())
}

/// The route each form proof schema belongs to, written at the use or through a `requirements`
/// entry (ADR 0002 section 9).
pub(crate) fn tree_schemas_form_proof_routes(
    nodes: &TreeNodes<'_>,
    inherited: &Inherited<'_>,
    requirements: Option<&JsonValue>,
) -> Result<IndexMap<String, String>, PassError> {
    let mut routes = IndexMap::new();

    for (node_id, node) in nodes.iter() {
        let media = node.settings.get("inputMedia");

        if !matches!(node.kind, TreeNodeKind::Route | TreeNodeKind::Op)
            || !node.settings.contains_key("input")
        {
            continue;
        }

        let Some(JsonValue::String(media)) = media else {
            continue;
        };

        if !FIELD_MEDIA.contains(&media.as_str()) {
            continue;
        }

        let entries = inherited
            .ordered(node_id, OrderedSetting::Requires)?
            .unwrap_or_default();

        for entry in entries {
            let item = match entry.value {
                JsonValue::String(name) => tree_schemas_member(requirements, name),
                other => Some(other),
            };
            let Some(JsonValue::String(rule)) = tree_schemas_member(item, "rule") else {
                continue;
            };
            let proof_schema = tree_schemas_pointer("/rules", &[rule, "proof", "schema"]);

            routes
                .entry(proof_schema)
                .or_insert_with(|| tree_schemas_pointer(&node.pointer, &["inputMedia"]));
        }
    }

    Ok(routes)
}

pub(crate) fn tree_schemas_query_wires(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    conventions: &ResolvedConventions<'_>,
    form_proofs: &IndexMap<String, String>,
) -> Result<IndexMap<String, QueryWire>, PassError> {
    let lists = encoding_of(conventions, EncodingConvention::Lists, &LISTS)?;
    let objects = encoding_of(conventions, EncodingConvention::Objects, &OBJECTS)?;
    let mut wires = IndexMap::new();

    for (id, pointer) in &compiler.written_at {
        let properties = compiler
            .object_properties(Some(&TypeUse::Ref(RefTypeUse {
                schema: SchemaId::new(id.clone()),
                unknown_keys: None,
                nullable: None,
                docs: None,
                examples: None,
            })))?
            .unwrap_or_default();

        for property in &properties {
            record_wire(
                compiler,
                &mut wires,
                tree_schemas_pointer(pointer, &["properties", &property.name]),
                Some(&property.r#type),
                (&lists, &objects),
            )?;
        }
    }

    let positions: Vec<String> = compiler.query_positions.iter().cloned().collect();

    for pointer in positions {
        let schema_use = compiler.uses.get(&pointer).cloned();
        let form_route = form_proofs.get(&pointer);

        if !is_map(compiler, schema_use.as_ref())? {
            record_wire(
                compiler,
                &mut wires,
                pointer,
                schema_use.as_ref(),
                (&lists, &objects),
            )?;
        } else if !compiler.body_proof_positions.contains(&pointer) {
            refuse_map_field(compiler, &pointer)?;
        } else if let Some(route) = form_route {
            refuse_map_form_proof(compiler, &pointer, route)?;
        }
    }

    Ok(wires)
}

fn record_wire(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    wires: &mut IndexMap<String, QueryWire>,
    pointer: String,
    schema_use: Option<&TypeUse>,
    encodings: (&Encoding, &Encoding),
) -> Result<(), PassError> {
    let Some(schema_use) = schema_use else {
        return Ok(());
    };

    if let Some(wire) = wire_of(compiler, schema_use, encodings)? {
        wires.insert(pointer, wire);
    }

    Ok(())
}

// The wire of a use: a single, a list of singles, or an object whose properties all are either.
fn wire_of(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema_use: &TypeUse,
    (lists, objects): (&Encoding, &Encoding),
) -> Result<Option<QueryWire>, PassError> {
    if let Some(single) = single_kind(schema_use)? {
        return Ok(Some(wire_with(single.wire_kind(), &SINGLE)));
    }

    if is_list_of_singles(schema_use)? {
        return Ok(Some(wire_with(QueryWireKind::List, lists)));
    }

    let Some(properties) = compiler.object_properties(Some(schema_use))? else {
        return Ok(None);
    };

    for property in &properties {
        if single_kind(&property.r#type)?.is_none() && !is_list_of_singles(&property.r#type)? {
            return Ok(None);
        }
    }

    Ok(Some(wire_with(QueryWireKind::Object, objects)))
}

fn wire_with(kind: QueryWireKind, encoding: &Encoding) -> QueryWire {
    QueryWire {
        kind,
        style: encoding.style.clone(),
        explode: encoding.explode,
        brackets: encoding.brackets,
    }
}

fn is_map(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema_use: Option<&TypeUse>,
) -> Result<bool, PassError> {
    let Some(schema_use) = schema_use else {
        return Ok(false);
    };
    let KnownTypeUseRef::Ref(reference) = KnownTypeUseRef::try_from(schema_use)? else {
        return Ok(false);
    };
    let Some(schema) = compiler.schemas.get(reference.schema.as_str()) else {
        return Ok(false);
    };

    Ok(matches!(
        KnownSchemaRef::try_from(schema)?,
        KnownSchemaRef::Map(_)
    ))
}

fn refuse_map_field(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    pointer: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMapField"))
}

fn refuse_map_form_proof(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    pointer: &str,
    route: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMapFormProof"))
}
