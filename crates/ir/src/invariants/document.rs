//! The entry point: every invariant violation of an IR document.

use seampact_json::{JsonObject, JsonValue};

use super::catalogue_refs::check_catalogue_id;
use super::decode::decode_member;
use super::json_members::{items, record};
use super::object_rules::{DocumentView, ObjectDefinitions, check_object};
use super::open_values::catalogues;
use super::operation::OperationScope;
use super::violation::{IrInvariantViolation, Violations};
use crate::instance_walk::{IrInstanceNode, walk_ir_instance};
use crate::{IrError, IrMap, Schema, SchemaId};

/// The root definition the walk reads a document as.
const ROOT_REFERENCE: &str = "#/$defs/ContractIR";

/// Every invariant violation of an IR document, empty for a sound one.
///
/// Pure. It reads the untyped document, so a document the open form accepts is checked whatever
/// its unknown tags and values: an unknown one is the reader's to name. A value that is no
/// object, or an object the schema does not read, is checked as an empty document.
///
/// # Errors
///
/// [`IrError::Decode`] when `schemas` or the responses of an operation do not decode as IR
/// types, which the schema validation refuses first; [`IrError::BrokenSchemas`] when the
/// embedded schema files are broken.
pub fn check_ir_invariants(ir: &JsonValue) -> Result<Vec<IrInvariantViolation>, IrError> {
    let empty = JsonObject::new();
    let document = record(Some(ir)).unwrap_or(&empty);
    let schema_entries = record(document.get("schemas")).unwrap_or(&empty);
    let schemas: IrMap<SchemaId, Schema> = match document.get("schemas") {
        Some(value @ JsonValue::Object(_)) => decode_member(Some(value))?,
        _ => IrMap::new(),
    };
    let view = DocumentView {
        document,
        schema_entries,
        rights: record(document.get("rights")).unwrap_or(&empty),
        errors: record(document.get("errors")).unwrap_or(&empty),
        operation: OperationScope {
            formats: record(document.get("formats")).unwrap_or(&empty),
            operations: items(document.get("operations")),
            api_id: record(document.get("api")).and_then(|api| api.get("id")),
            schemes: record(document.get("schemes")).unwrap_or(&empty),
            schemas: &schemas,
        },
    };
    let catalogues = catalogues()?;
    let root: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(ROOT_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut objects = ObjectDefinitions::new();
    let mut references = Violations::default();
    let mut rules = Violations::default();

    walk_ir_instance(ir, &root, "", &mut |node| match node {
        IrInstanceNode::Object {
            pointer,
            definition,
            value,
        } => {
            objects.insert((*pointer).to_owned(), definition.map(str::to_owned));

            check_object(*definition, value, pointer, &view, &objects, &mut rules)
        }
        IrInstanceNode::Union { .. }
        | IrInstanceNode::OpenEnum { .. }
        | IrInstanceNode::MalformedOpenEnum { .. } => Ok(()),
    })?;

    let mut found = references.into_vec();

    found.extend(rules.into_vec());

    Ok(found)
}
