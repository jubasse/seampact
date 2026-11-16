//! The id collision check of finalize (ADR 0004 section 9): every name that becomes a key of
//! `components.schemas` in a document is distinct.
//!
//! Those names are the ids of the schemas (declared and hoisted), the enums and the named formats,
//! and `<schema id>.input`, the strict input component of a schema; an error code equal to one of
//! them, the input name of an operation that reads body proofs equal to another id, or two
//! catalogues sharing an id is a compile error naming both. The names are the ids themselves,
//! which no document option changes, so the check holds under every option.

use std::collections::HashMap;

use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_ir::Origin;
use seampact_json::{JsonObject, JsonValue, js_text_of};
use seampact_naming::{CanonicalIdOptions, Name, Role, canonical_id};

use crate::json_origin::{origin_member, origin_of};
use crate::record::finalize_is_record;

/// The rule id of an id collision.
pub const FINALIZE_ID_COLLISION_RULE: &str = "seampact/finalize/id-collision";

/// The rule ids finalize reports.
pub const RULE_IDS: &[RuleId] = &[RuleId::from_static(FINALIZE_ID_COLLISION_RULE)];

const STRICT_INPUT_SUFFIX: &str = ".input";

/// One side of a collision: what it is, in a message's words, and where it is declared.
#[derive(Debug, Clone)]
struct CollisionSide {
    what: String,
    origin: Option<Origin>,
}

/// A name that becomes a key of `components.schemas`.
#[derive(Debug, Clone)]
struct ComponentName {
    key: String,
    side: CollisionSide,
}

fn entries_of<'ir>(ir: &'ir JsonObject, member: &str) -> Vec<(&'ir String, &'ir JsonValue)> {
    match ir.get(member) {
        Some(JsonValue::Object(entries)) => entries.iter().collect(),
        _ => Vec::new(),
    }
}

// The component names of the IR, in catalogue order: schemas, enums, named formats, then the strict inputs.
fn component_names(ir: &JsonObject) -> Result<Vec<ComponentName>, InternalError> {
    let schemas = entries_of(ir, "schemas");
    let mut names = Vec::new();

    for (id, schema) in &schemas {
        names.push(ComponentName {
            key: (*id).clone(),
            side: CollisionSide {
                what: format!("the schema '{id}'"),
                origin: origin_of(schema)?,
            },
        });
    }

    for (id, entry) in entries_of(ir, "enums") {
        names.push(ComponentName {
            key: id.clone(),
            side: CollisionSide {
                what: format!("the enum '{id}'"),
                origin: origin_of(entry)?,
            },
        });
    }

    for (id, scalar) in entries_of(ir, "scalars") {
        names.push(ComponentName {
            key: id.clone(),
            side: CollisionSide {
                what: format!("the named format '{id}'"),
                origin: origin_of(scalar)?,
            },
        });
    }

    for (id, schema) in &schemas {
        names.push(ComponentName {
            key: format!("{id}{STRICT_INPUT_SUFFIX}"),
            side: CollisionSide {
                what: format!("the strict input '{id}{STRICT_INPUT_SUFFIX}' of the schema '{id}'"),
                origin: origin_of(schema)?,
            },
        });
    }

    Ok(names)
}

fn diagnostic_origin(side: &CollisionSide) -> Option<DiagnosticOrigin> {
    side.origin.as_ref().and_then(DiagnosticOrigin::of)
}

// The diagnostic located at `located`, or at `other` when `located` is a core declaration, which has
// no file (ADR 0004 section 11); a core side is named in the message but has no related location.
fn collision_diagnostic(
    located: &CollisionSide,
    other: &CollisionSide,
    text: impl FnOnce(&CollisionSide, &CollisionSide) -> (String, String),
) -> Result<Diagnostic, InternalError> {
    let (first, second) = if diagnostic_origin(located).is_some() {
        (located, other)
    } else {
        (other, located)
    };
    let Some(origin) = diagnostic_origin(first) else {
        return Err(InternalError::new(format!(
            "finalize found {} and {} under one id, and neither has an authored origin to locate it at",
            located.what, other.what
        )));
    };
    let related = diagnostic_origin(second)
        .map(|origin| RelatedLocation {
            origin,
            message: format!("{} is declared here", second.what),
        })
        .into_iter()
        .collect();
    let (message, fix) = text(first, second);

    Ok(Diagnostic {
        severity: Severity::Error,
        rule: RuleId::from_static(FINALIZE_ID_COLLISION_RULE),
        message,
        fix,
        origin,
        related,
    })
}

fn capitalized(text: &str) -> String {
    let mut characters = text.chars();

    match characters.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), characters.as_str()),
        None => String::new(),
    }
}

// Two catalogues sharing an id: located at the first in catalogue order (a schema before an enum before a format).
fn catalogue_collisions(names: &[ComponentName]) -> Result<Vec<Diagnostic>, InternalError> {
    let mut claimed: HashMap<&str, &ComponentName> = HashMap::new();
    let mut diagnostics = Vec::new();

    for name in names {
        let Some(first) = claimed.get(name.key.as_str()) else {
            claimed.insert(&name.key, name);
            continue;
        };

        diagnostics.push(collision_diagnostic(&first.side, &name.side, |one, two| {
            (
                format!(
                    "{} and {} have one id, so a document would write both as the component '{}'.",
                    capitalized(&one.what),
                    two.what,
                    name.key
                ),
                "Rename one of them.".to_owned(),
            )
        })?);
    }

    Ok(diagnostics)
}

// An error code equal to a component name, located at the code.
fn code_collisions(
    ir: &JsonObject,
    components: &HashMap<&str, &ComponentName>,
) -> Result<Vec<Diagnostic>, InternalError> {
    let mut diagnostics = Vec::new();

    for (code, declaration) in entries_of(ir, "errors") {
        let Some(component) = components.get(code.as_str()) else {
            continue;
        };
        let side = CollisionSide {
            what: format!("the error code '{code}'"),
            origin: origin_of(declaration)?,
        };

        diagnostics.push(collision_diagnostic(&side, &component.side, |_, _| {
            (
                format!(
                    "The error code '{code}' equals the id of {}, so a document would write both as the component '{code}'.",
                    component.side.what
                ),
                "Rename the code.".to_owned(),
            )
        })?);
    }

    Ok(diagnostics)
}

fn name_segments(name: &JsonObject) -> Result<Vec<String>, InternalError> {
    let Some(JsonValue::Array(segments)) = name.get("segments") else {
        return Err(InternalError::new("an operation name has no segments"));
    };

    segments
        .iter()
        .map(|segment| match segment {
            JsonValue::String(text) => Ok(text.clone()),
            _ => Err(InternalError::new("an operation name segment is no string")),
        })
        .collect()
}

// The input name of an operation that reads body proofs (ADR 0004 section 13), when it is not the
// operation's own input schema, which already carries that name.
fn proof_input_name(operation: &JsonObject) -> Result<Option<String>, InternalError> {
    let Some(JsonValue::Object(name)) = operation.get("name") else {
        return Ok(None);
    };
    let Some(input) = operation.get("input").and_then(finalize_is_record) else {
        return Ok(None);
    };

    if !matches!(input.get("proofs"), Some(JsonValue::Array(proofs)) if !proofs.is_empty()) {
        return Ok(None);
    }

    let naming = Name {
        segments: name_segments(name)?,
        role: Role::Input,
        status: None,
    };
    let input_name = canonical_id(&naming, CanonicalIdOptions::default())
        .map_err(|error| InternalError::new(error.to_string()))?
        .ok_or_else(|| InternalError::new("an operation input name has no canonical id"))?;
    let own_schema = match input.get("schema").and_then(finalize_is_record) {
        Some(schema) => match (schema.get("kind"), schema.get("schema")) {
            (Some(JsonValue::String(kind)), Some(JsonValue::String(id))) if kind == "ref" => {
                Some(id.as_str())
            }
            _ => None,
        },
        None => None,
    };

    Ok((Some(input_name.as_str()) != own_schema).then_some(input_name))
}

// A proof input name equal to another id: a component name or an error code, located at the operation.
fn proof_input_collisions(
    ir: &JsonObject,
    components: &HashMap<&str, &ComponentName>,
) -> Result<Vec<Diagnostic>, InternalError> {
    let Some(JsonValue::Array(operations)) = ir.get("operations") else {
        return Ok(Vec::new());
    };
    let mut diagnostics = Vec::new();

    for operation in operations {
        let Some(operation) = finalize_is_record(operation) else {
            continue;
        };
        let Some(input_name) = proof_input_name(operation)? else {
            continue;
        };
        let code = match ir.get("errors") {
            Some(JsonValue::Object(errors)) => errors.get(&input_name),
            _ => None,
        };
        let other = match (components.get(input_name.as_str()), code) {
            (Some(component), _) => component.side.clone(),
            (None, Some(code)) => CollisionSide {
                what: format!("the error code '{input_name}'"),
                origin: origin_of(code)?,
            },
            (None, None) => continue,
        };
        let operation_id = js_text_of(operation.get("id"));
        let side = CollisionSide {
            what: format!("the operation '{operation_id}'"),
            origin: origin_member(operation)?,
        };

        diagnostics.push(collision_diagnostic(&side, &other, |_, _| {
            (
                format!(
                    "The operation '{operation_id}' reads body proofs, so its input is the component '{input_name}', which is also the id of {}.",
                    other.what
                ),
                format!("Rename the operation '{operation_id}' or {}.", other.what),
            )
        })?);
    }

    Ok(diagnostics)
}

/// Every id collision of `ir`, finalize's pruned copy of the draft, in catalogue, then code, then
/// operation order.
///
/// # Errors
///
/// An [`InternalError`] for a malformed origin, or a collision no authored origin can locate.
pub fn finalize_id_collisions(ir: &JsonValue) -> Result<Vec<Diagnostic>, InternalError> {
    let Some(root) = finalize_is_record(ir) else {
        return Ok(Vec::new());
    };
    let names = component_names(root)?;
    let mut components: HashMap<&str, &ComponentName> = HashMap::new();

    for name in &names {
        components.entry(&name.key).or_insert(name);
    }

    let mut collisions = catalogue_collisions(&names)?;

    collisions.extend(code_collisions(root, &components)?);
    collisions.extend(proof_input_collisions(root, &components)?);

    Ok(collisions)
}
