//! The schema positions of the catalogues (principals, header schemas, scope and subject ids,
//! params, rule proofs) and the route positions of the tree: each compiled with the directions its
//! position is read or written in.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, Name};
use seampact_json::{JsonObject, JsonValue};
use seampact_naming::{NameSource, SegmentsOptions, SegmentsResult, segments_of, split_name};
use seampact_pass_tree_shared::TreeNodesOperationName;
use seampact_pipeline::{PassError, TreeNode, TreeNodeKind, TreeNodes};

use crate::compile::{TreeSchemasCompiler, TreeSchemasPlace, TreeSchemasPosition};
use crate::not_ported::not_ported_yet;
use crate::raw::{
    tree_schemas_entries, tree_schemas_is_object, tree_schemas_member, tree_schemas_pointer,
};

/// The directions of a position read by the server.
const INPUT: [Direction; 1] = [Direction::Input];
/// The directions of a position written by the server.
const OUTPUT: [Direction; 1] = [Direction::Output];
/// The directions of a position both read and written.
const BOTH: [Direction; 2] = [Direction::Input, Direction::Output];

/// The roles a route's schema name is derived for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RouteRole {
    Input,
    Output,
    Query,
    Headers,
    Path,
}

/// One fields map of a route: its key, the role its inline schemas are named after, and the place
/// its entries sit in.
#[derive(Debug, Clone, Copy)]
struct RouteFieldsMap {
    key: &'static str,
    role: Option<RouteRole>,
    place: TreeSchemasPlace,
}

/// Every fields map of a route is read from the request; an optional query field may hold a default.
const FIELDS_MAPS: [RouteFieldsMap; 4] = [
    RouteFieldsMap {
        key: "id",
        role: None,
        place: TreeSchemasPlace::Position,
    },
    RouteFieldsMap {
        key: "pathParams",
        role: Some(RouteRole::Path),
        place: TreeSchemasPlace::Position,
    },
    RouteFieldsMap {
        key: "query",
        role: Some(RouteRole::Query),
        place: TreeSchemasPlace::QueryField,
    },
    RouteFieldsMap {
        key: "headers",
        role: Some(RouteRole::Headers),
        place: TreeSchemasPlace::Position,
    },
];

/// The node kinds that are operations: routes and ops.
fn position_at(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    value: Option<&JsonValue>,
    pointer: &str,
    directions: &[Direction],
) -> Result<(), PassError> {
    Err(not_ported_yet("positionAt"))
}

fn header_directions(declaration: Option<&JsonValue>) -> Result<Vec<Direction>, PassError> {
    Err(not_ported_yet("headerDirections"))
}

/// The params of a right, rule or error: a fields map hoisted as `<owner>Params`.
fn params_at(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    declaration: &JsonValue,
    pointer: &str,
    segments: &[String],
    directions: &[Direction],
) -> Result<(), PassError> {
    Err(not_ported_yet("paramsAt"))
}

pub(crate) fn tree_schemas_compile_declarations(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    merged: &JsonObject,
) -> Result<(), PassError> {
    for (id, identity) in tree_schemas_entries(merged.get("identities")) {
        compile_identity(compiler, merged, id, identity)?;
    }

    for (id, header) in tree_schemas_entries(merged.get("headers")) {
        position_at(
            compiler,
            tree_schemas_member(Some(header), "schema"),
            &tree_schemas_pointer("/headers", &[id, "schema"]),
            &header_directions(Some(header))?,
        )?;
    }

    for (id, scope) in tree_schemas_entries(merged.get("scopes")) {
        position_at(
            compiler,
            tree_schemas_member(Some(scope), "id"),
            &tree_schemas_pointer("/scopes", &[id, "id"]),
            &INPUT,
        )?;
    }

    for (id, right) in tree_schemas_entries(merged.get("rights")) {
        compile_right(compiler, id, right)?;
    }

    for (id, rule) in tree_schemas_entries(merged.get("rules")) {
        compile_rule(compiler, id, rule)?;
    }

    // A meta field fills a success envelope, so its schema is output.
    for (id, format) in tree_schemas_entries(merged.get("formats")) {
        for (name, field) in tree_schemas_entries(tree_schemas_member(Some(format), "meta")) {
            position_at(
                compiler,
                tree_schemas_member(Some(field), "schema"),
                &tree_schemas_pointer("/formats", &[id, "meta", name, "schema"]),
                &OUTPUT,
            )?;
        }
    }

    Ok(())
}

fn compile_identity(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    merged: &JsonObject,
    id: &str,
    identity: &JsonValue,
) -> Result<(), PassError> {
    let at = tree_schemas_pointer("/identities", &[id]);
    let principal = tree_schemas_member(Some(identity), "principal");
    let variants = tree_schemas_member(principal, "variants");

    if tree_schemas_is_object(variants) {
        for (variant, schema) in tree_schemas_entries(variants) {
            position_at(
                compiler,
                Some(schema),
                &tree_schemas_pointer(&at, &["principal", "variants", variant]),
                &OUTPUT,
            )?;
        }
    } else {
        position_at(
            compiler,
            principal,
            &tree_schemas_pointer(&at, &["principal"]),
            &OUTPUT,
        )?;
    }

    for (header, header_use) in tree_schemas_entries(tree_schemas_member(Some(identity), "headers"))
    {
        position_at(
            compiler,
            tree_schemas_member(Some(header_use), "schema"),
            &tree_schemas_pointer(&at, &["headers", header, "schema"]),
            &header_directions(tree_schemas_member(merged.get("headers"), header))?,
        )?;
    }

    Ok(())
}

fn compile_right(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    id: &str,
    right: &JsonValue,
) -> Result<(), PassError> {
    let at = tree_schemas_pointer("/rights", &[id]);
    let code_name = match tree_schemas_member(Some(right), "codeName") {
        Some(JsonValue::String(text)) => Some(text.clone()),
        _ => None,
    };
    let options = SegmentsOptions {
        code_name,
        position: None,
    };
    // A right without segments and without codeName is access.rights' error; its params are named
    // once it has one.
    let segments = match segments_of(id, NameSource::Right, &options)
        .map_err(|error| PassError::from(InternalError::new(error.to_string())))?
    {
        SegmentsResult::Segments(segments) => segments,
        SegmentsResult::NoSegment => Vec::new(),
    };

    params_at(compiler, right, &at, &segments, &INPUT)?;

    let subject = tree_schemas_member(Some(right), "subject");

    position_at(
        compiler,
        tree_schemas_member(subject, "id"),
        &tree_schemas_pointer(&at, &["subject", "id"]),
        &INPUT,
    )
}

fn compile_rule(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    id: &str,
    rule: &JsonValue,
) -> Result<(), PassError> {
    let at = tree_schemas_pointer("/rules", &[id]);

    params_at(compiler, rule, &at, &split_name(id), &INPUT)?;

    let proof = tree_schemas_member(Some(rule), "proof");
    let proof_pointer = tree_schemas_pointer(&at, &["proof", "schema"]);

    position_at(
        compiler,
        tree_schemas_member(proof, "schema"),
        &proof_pointer,
        &INPUT,
    )?;
    compiler.query_positions.insert(proof_pointer.clone());

    if matches!(tree_schemas_member(proof, "in"), Some(JsonValue::String(place)) if place == "body")
    {
        compiler.body_proof_positions.insert(proof_pointer);
    }

    Ok(())
}

fn route_name(
    operation: Option<&Name>,
    role: RouteRole,
) -> Result<Option<seampact_naming::Name>, PassError> {
    Err(not_ported_yet("routeName"))
}

fn response_name(
    operation: Option<&Name>,
    status: &str,
) -> Result<Option<seampact_naming::Name>, PassError> {
    Err(not_ported_yet("responseName"))
}

/// A fields map entry: an inline schema there is named as a property of the map's derived name.
fn route_fields_at(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    fields: Option<&JsonValue>,
    pointer: &str,
    owner: Option<&seampact_naming::Name>,
    directions: &[Direction],
    optional_place: TreeSchemasPlace,
) -> Result<(), PassError> {
    Err(not_ported_yet("routeFieldsAt"))
}

/// Compiles the route positions of the tree, an inline schema hoisted under the name its operation
/// derives. A relay route writes none; neither does an operation `names` lacks, whose naming problem
/// `tree.nodes` reports.
pub(crate) fn tree_schemas_compile_routes(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
) -> Result<(), PassError> {
    for (_, node) in nodes.iter() {
        let operation = names.get(&node.pointer).map(|named| &named.name);

        if node.kind == TreeNodeKind::Relay || (is_operation_kind(node.kind) && operation.is_none())
        {
            continue;
        }

        compile_route(compiler, node, operation)?;
    }

    Ok(())
}

fn is_operation_kind(kind: TreeNodeKind) -> bool {
    matches!(kind, TreeNodeKind::Route | TreeNodeKind::Op)
}

fn compile_route(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    node: &TreeNode<'_>,
    operation: Option<&Name>,
) -> Result<(), PassError> {
    let settings = node.settings;
    let at = |segments: &[&str]| tree_schemas_pointer(&node.pointer, segments);

    position_at(compiler, settings.get("item"), &at(&["item"]), &OUTPUT)?;

    if let Some(input) = settings.get("input") {
        compiler.position(
            input,
            &TreeSchemasPosition {
                pointer: at(&["input"]),
                name: route_name(operation, RouteRole::Input)?,
                place: TreeSchemasPlace::RouteInput,
                id: None,
            },
            &INPUT,
        )?;
    }

    if let Some(output) = settings.get("output") {
        compiler.position(
            output,
            &TreeSchemasPosition {
                pointer: at(&["output"]),
                name: route_name(operation, RouteRole::Output)?,
                place: TreeSchemasPlace::Position,
                id: None,
            },
            &OUTPUT,
        )?;
    }

    for (status, response) in tree_schemas_entries(settings.get("responses")) {
        if let Some(body) = tree_schemas_member(Some(response), "body") {
            compiler.position(
                body,
                &TreeSchemasPosition {
                    pointer: at(&["responses", status, "body"]),
                    name: response_name(operation, status)?,
                    place: TreeSchemasPlace::Position,
                    id: None,
                },
                &OUTPUT,
            )?;
        }

        route_fields_at(
            compiler,
            tree_schemas_member(Some(response), "headers"),
            &at(&["responses", status, "headers"]),
            None,
            &OUTPUT,
            TreeSchemasPlace::Position,
        )?;
    }

    for fields_map in FIELDS_MAPS {
        let owner = match fields_map.role {
            Some(role) => route_name(operation, role)?,
            None => None,
        };

        route_fields_at(
            compiler,
            settings.get(fields_map.key),
            &at(&[fields_map.key]),
            owner.as_ref(),
            &INPUT,
            fields_map.place,
        )?;
    }

    // A query field written as a schema name has its wire at the schema's properties.
    for (key, _) in tree_schemas_entries(settings.get("query")) {
        compiler.query_positions.insert(at(&["query", key]));
    }

    Ok(())
}
