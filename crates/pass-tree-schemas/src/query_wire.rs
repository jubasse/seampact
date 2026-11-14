//! The query wire form of each query or form field (ADR 0002 section 7), keyed by its position in
//! the input schema, and of each rule proof schema.

use indexmap::IndexMap;
use seampact_ir::{QueryStyle, QueryWire, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{Inherited, PassError, ResolvedConventions, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;

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
const ROUTE_KINDS: [&str; 2] = ["route", "op"];

/// Which convention an encoding is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncodingConvention {
    Lists,
    Objects,
}

fn encoding_of(
    conventions: &ResolvedConventions<'_>,
    convention: EncodingConvention,
    table: &[(&str, Encoding)],
) -> Result<Encoding, PassError> {
    Err(not_ported_yet("encodingOf"))
}

fn single_kind(schema_use: &TypeUse) -> Result<Option<SingleKind>, PassError> {
    Err(not_ported_yet("singleKind"))
}

fn is_list_of_singles(schema_use: &TypeUse) -> Result<bool, PassError> {
    Err(not_ported_yet("isListOfSingles"))
}

/// The route each form proof schema belongs to, written at the use or through a `requirements`
/// entry (ADR 0002 section 9).
pub(crate) fn tree_schemas_form_proof_routes(
    nodes: &TreeNodes<'_>,
    inherited: &Inherited<'_>,
    requirements: Option<&JsonValue>,
) -> Result<IndexMap<String, String>, PassError> {
    Err(not_ported_yet("treeSchemasFormProofRoutes"))
}

pub(crate) fn tree_schemas_query_wires(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    conventions: &ResolvedConventions<'_>,
    form_proofs: &IndexMap<String, String>,
) -> Result<IndexMap<String, QueryWire>, PassError> {
    Err(not_ported_yet("treeSchemasQueryWires"))
}

fn is_map(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema_use: Option<&TypeUse>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("isMap"))
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
