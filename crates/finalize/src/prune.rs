//! The pruning of finalize (ADR 0004 section 2): only the declarations reachable from an
//! operation, an identity or a convention stay in the IR, core declarations included.
//!
//! A declaration is reached through a member that holds its id (a `SchemaId`, an `ErrorCode`...),
//! through an extension value written under its prefix and key, or through a core origin that
//! points at it (a params schema's origin names its code). References are followed to a fixed
//! point, so a code, then its params schema, then the issue schema those params name are kept
//! together. Convention values are opaque JSON, so a convention reaches no declaration at this
//! irRevision.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use seampact_diagnostics::InternalError;
use seampact_ir::{IrInstanceNode, ir_definition, walk_ir_instance};
use seampact_json::{JsonObject, JsonValue, pointer_segments};

use crate::record::finalize_is_record;

/// One catalogue entry: its top-level member (`schemas`) and its key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CatalogueEntry {
    member: String,
    id: String,
}

/// The catalogues identities live in: every identity is kept, as a root of the reachability.
const ROOT_CATALOGUES: &[&str] = &["identities"];
const EXTENSION_KEYS_MEMBER: &str = "extensionKeys";
const CORE_LAYER: &str = "core";
const ORIGIN_DEFINITION: &str = "Origin";
const CONTRACT_IR_REFERENCE: &str = "#/$defs/ContractIR";

/// The catalogue members of the `ContractIR` schema and the id definition each holds.
struct Catalogues {
    /// The catalogue member of each id definition (`SchemaId` gives `schemas`).
    member_of_definition: HashMap<String, String>,
    members: HashSet<String>,
}

static CATALOGUES: LazyLock<Result<Catalogues, String>> = LazyLock::new(read_catalogues);

// The catalogue member of each id definition, read from the ContractIR schema: every top-level map
// whose keys are a `$ref` to an id definition (`schemas` keyed by `SchemaId`).
fn read_catalogues() -> Result<Catalogues, String> {
    let definition = ir_definition("ContractIR")
        .map_err(|error| error.to_string())?
        .ok_or("finalize found no ContractIR in the IR schema")?;
    let Some(JsonValue::Object(properties)) = definition.get("properties") else {
        return Err("finalize found no ContractIR in the IR schema".to_owned());
    };
    let mut member_of_definition = HashMap::new();

    for (member, schema) in properties {
        let Some(JsonValue::Object(schema)) = Some(schema) else {
            continue;
        };
        let Some(JsonValue::Object(keys)) = schema.get("propertyNames") else {
            continue;
        };
        let Some(JsonValue::String(reference)) = keys.get("$ref") else {
            continue;
        };
        let name = reference
            .rsplit_once('/')
            .map_or(reference.as_str(), |(_, name)| name);

        member_of_definition.insert(name.to_owned(), member.clone());
    }

    let members = member_of_definition.values().cloned().collect();

    Ok(Catalogues {
        member_of_definition,
        members,
    })
}

fn catalogues() -> Result<&'static Catalogues, InternalError> {
    CATALOGUES
        .as_ref()
        .map_err(|what| InternalError::new(what.clone()))
}

// The entries of a catalogue member of the draft, or `None` for a member that is no catalogue.
fn catalogue_of<'ir>(
    ir: &'ir JsonValue,
    member: &str,
    catalogues: &Catalogues,
) -> Option<&'ir JsonObject> {
    if !catalogues.members.contains(member) {
        return None;
    }

    match finalize_is_record(ir)?.get(member)? {
        JsonValue::Object(entries) => Some(entries),
        _ => None,
    }
}

// The catalogue entry a pointer of the draft is inside, or `None` for a pointer outside every
// catalogue (an operation, the api, the conventions), which is a root.
fn owner_of(pointer: &str, catalogues: &Catalogues) -> Option<CatalogueEntry> {
    let segments = pointer_segments(pointer).unwrap_or_default();
    let (Some(member), Some(id)) = (segments.first(), segments.get(1)) else {
        return None;
    };

    catalogues.members.contains(member).then(|| CatalogueEntry {
        member: member.clone(),
        id: id.clone(),
    })
}

// The entry a core origin points at: `/errors/api.rate_limited/params` names `errors` entry
// `api.rate_limited`. An origin that carries `api` names an entry of that other api, never of this one.
fn core_origin_target(origin: &JsonObject, catalogues: &Catalogues) -> Option<CatalogueEntry> {
    let is_core =
        matches!(origin.get("layer"), Some(JsonValue::String(layer)) if layer == CORE_LAYER);

    if !is_core || origin.contains_key("api") {
        return None;
    }

    match origin.get("pointer") {
        Some(JsonValue::String(pointer)) => owner_of(pointer, catalogues),
        _ => None,
    }
}

// The extension key declarations, by their prefix and key, as an extension slot names them.
fn extension_key_ids(ir: &JsonValue, catalogues: &Catalogues) -> HashMap<(String, String), String> {
    let mut ids = HashMap::new();
    let Some(declarations) = catalogue_of(ir, EXTENSION_KEYS_MEMBER, catalogues) else {
        return ids;
    };

    for (id, declaration) in declarations {
        let Some(declaration) = finalize_is_record(declaration) else {
            continue;
        };

        if let (Some(JsonValue::String(prefix)), Some(JsonValue::String(key))) =
            (declaration.get("prefix"), declaration.get("key"))
        {
            ids.insert((prefix.clone(), key.clone()), id.clone());
        }
    }

    ids
}

// The entries an extension slot uses: one per `<prefix>.<key>` written that has a declaration.
fn extension_targets(
    extensions: &JsonObject,
    key_ids: &HashMap<(String, String), String>,
) -> Vec<CatalogueEntry> {
    let mut targets = Vec::new();

    for (prefix, keys) in extensions {
        let Some(keys) = finalize_is_record(keys) else {
            continue;
        };

        for key in keys.keys() {
            if let Some(id) = key_ids.get(&(prefix.clone(), key.clone())) {
                targets.push(CatalogueEntry {
                    member: EXTENSION_KEYS_MEMBER.to_owned(),
                    id: id.clone(),
                });
            }
        }
    }

    targets
}

/// Every reference of the draft, keyed by the entry that holds it (`None` for a root).
type References = HashMap<Option<CatalogueEntry>, Vec<CatalogueEntry>>;

fn references_by_owner(
    ir: &JsonValue,
    catalogues: &Catalogues,
) -> Result<References, InternalError> {
    let mut references = References::new();
    let key_ids = extension_key_ids(ir, catalogues);
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(CONTRACT_IR_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut add = |pointer: &str, targets: Vec<CatalogueEntry>| {
        references
            .entry(owner_of(pointer, catalogues))
            .or_default()
            .extend(targets);
    };

    walk_ir_instance(ir, &schema, "", &mut |node| {
        match node {
            IrInstanceNode::String {
                pointer,
                definition,
                value,
            } => {
                if let Some(member) = catalogues.member_of_definition.get(*definition) {
                    add(
                        pointer,
                        vec![CatalogueEntry {
                            member: member.clone(),
                            id: (*value).to_owned(),
                        }],
                    );
                }
            }
            IrInstanceNode::Object {
                pointer,
                definition,
                value,
            } => {
                if *definition == Some(ORIGIN_DEFINITION)
                    && let Some(target) = core_origin_target(value, catalogues)
                {
                    add(pointer, vec![target]);
                }

                if let Some(JsonValue::Object(extensions)) = value.get("extensions") {
                    add(pointer, extension_targets(extensions, &key_ids));
                }
            }
            IrInstanceNode::Union { .. }
            | IrInstanceNode::OpenEnum { .. }
            | IrInstanceNode::MalformedOpenEnum { .. } => {}
        }

        Ok(())
    })
    .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(references)
}

// The entries reachable from the operations, the identities and every other root member.
fn reachable_entries(
    ir: &JsonValue,
    catalogues: &Catalogues,
) -> Result<HashSet<CatalogueEntry>, InternalError> {
    let references = references_by_owner(ir, catalogues)?;
    let mut reached = HashSet::new();
    let mut pending: Vec<CatalogueEntry> = references.get(&None).cloned().unwrap_or_default();

    for member in ROOT_CATALOGUES {
        for id in catalogue_of(ir, member, catalogues)
            .map(JsonObject::keys)
            .into_iter()
            .flatten()
        {
            pending.push(CatalogueEntry {
                member: (*member).to_owned(),
                id: id.clone(),
            });
        }
    }

    while let Some(next) = pending.pop() {
        if reached.contains(&next) {
            continue;
        }

        if let Some(held) = references.get(&Some(next.clone())) {
            pending.extend(held.iter().cloned());
        }

        reached.insert(next);
    }

    Ok(reached)
}

/// Drops from `ir`, finalize's copy of the draft, every catalogue entry no operation, identity or
/// other root reaches.
///
/// # Errors
///
/// An [`InternalError`] when the IR schemas are broken.
pub fn finalize_prune(ir: &mut JsonValue) -> Result<(), InternalError> {
    let catalogues = catalogues()?;
    let reached = reachable_entries(ir, catalogues)?;
    let JsonValue::Object(root) = ir else {
        return Ok(());
    };

    for member in &catalogues.members {
        let Some(JsonValue::Object(entries)) = root.get_mut(member) else {
            continue;
        };
        let unreached: Vec<String> = entries
            .keys()
            .filter(|id| {
                !reached.contains(&CatalogueEntry {
                    member: member.clone(),
                    id: (*id).clone(),
                })
            })
            .cloned()
            .collect();

        for id in unreached {
            entries.remove(&id);
        }
    }

    Ok(())
}
