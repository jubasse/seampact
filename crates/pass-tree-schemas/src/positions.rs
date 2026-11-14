//! The schema positions of the catalogues (principals, header schemas, scope and subject ids,
//! params, rule proofs) and the route positions of the tree: each compiled with the directions its
//! position is read or written in.

use indexmap::IndexMap;
use seampact_ir::{Direction, Name};
use seampact_json::{JsonObject, JsonValue};
use seampact_pass_tree_shared::TreeNodesOperationName;
use seampact_pipeline::{PassError, TreeNodes};

use crate::compile::{TreeSchemasCompiler, TreeSchemasPlace};
use crate::not_ported::not_ported_yet;

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
const OPERATION_KINDS: [&str; 2] = ["route", "op"];

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
    Err(not_ported_yet("treeSchemasCompileDeclarations"))
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
    Err(not_ported_yet("treeSchemasCompileRoutes"))
}
