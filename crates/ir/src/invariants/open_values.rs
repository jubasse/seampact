//! The known values of the open enums and the catalogues an id names, read from the schema files.

use std::collections::HashMap;

use seampact_json::{JsonValue, object_of, text_of};

use crate::IrError;
use crate::instance_walk::{KNOWN_VALUES_KEYWORD, ir_definition};

/// The members of the document root and of the api whose keys are ids.
const CATALOGUE_OWNERS: [(&str, CatalogueOwner); 2] = [
    ("ContractIR", CatalogueOwner::Document),
    ("Api", CatalogueOwner::Api),
];

/// Where a catalogue sits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CatalogueOwner {
    Document,
    Api,
}

/// A map of the document whose keys are the ids of one definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Catalogue {
    pub(super) owner: CatalogueOwner,
    pub(super) member: String,
}

fn last_segment(reference: &str) -> &str {
    reference
        .rsplit_once('/')
        .map_or(reference, |(_, name)| name)
}

fn broken(what: String) -> IrError {
    IrError::BrokenSchemas { what }
}

/// The known values of the open enum that `definition.member` references.
pub(super) fn known_values(
    definition: &str,
    member: &str,
) -> Result<&'static [JsonValue], IrError> {
    let properties = object_of(ir_definition(definition)?.and_then(|node| node.get("properties")));
    let mut node = object_of(properties.and_then(|properties| properties.get(member)));

    while let Some(reference) = text_of(node.and_then(|node| node.get("$ref"))) {
        node = ir_definition(last_segment(reference))?;
    }

    match node.and_then(|node| node.get(KNOWN_VALUES_KEYWORD)) {
        Some(JsonValue::Array(known)) => Ok(known),
        _ => Err(broken(format!("{definition}.{member} is not an open enum"))),
    }
}

/// Whether `value` is a string among the known values of `definition.member`.
pub(super) fn is_known(
    definition: &str,
    member: &str,
    value: Option<&JsonValue>,
) -> Result<bool, IrError> {
    let Some(text) = text_of(value) else {
        return Ok(false);
    };
    let known = known_values(definition, member)?;

    Ok(known
        .iter()
        .any(|candidate| matches!(candidate, JsonValue::String(known) if known == text)))
}

/// The catalogues an id names, by the id definition that keys them: every map of the document
/// root and of the api whose keys are a `$ref` to an id definition.
pub(super) fn catalogues() -> Result<HashMap<String, Catalogue>, IrError> {
    let mut found = HashMap::new();

    for (owner_definition, owner) in CATALOGUE_OWNERS {
        let Some(JsonValue::Object(properties)) =
            ir_definition(owner_definition)?.and_then(|node| node.get("properties"))
        else {
            continue;
        };

        for (member, schema) in properties {
            if let Some(id_definition) = key_definition(schema) {
                found.insert(
                    id_definition.to_owned(),
                    Catalogue {
                        owner,
                        member: member.clone(),
                    },
                );
            }
        }
    }

    Ok(found)
}

// The definition a map schema's `propertyNames` references.
fn key_definition(schema: &JsonValue) -> Option<&str> {
    let JsonValue::Object(schema) = schema else {
        return None;
    };
    let JsonValue::Object(keys) = schema.get("propertyNames")? else {
        return None;
    };
    let JsonValue::String(reference) = keys.get("$ref")? else {
        return None;
    };

    Some(last_segment(reference))
}
