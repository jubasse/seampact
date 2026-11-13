//! The declarations an api's layers write and whether the contract reaches each, for the lint rule
//! that reports the unused ones.
//!
//! Finalize drops an unreached entry from the IR (ADR 0004 section 2), so only the merged raw
//! catalogues still list it.

use std::collections::HashSet;

use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_ir::{ContractIr, Origin};
use seampact_json::JsonValue;

use super::pointer::{pipeline_origin, pointer_below};

/// The catalogues of grammar 01 (the `requirements` entries expand into each route's `requires`)
/// and `formats`.
const DECLARED_CATALOGUES: [&str; 16] = [
    "schemas",
    "enums",
    "scalars",
    "errors",
    "natures",
    "schemes",
    "headers",
    "identities",
    "rights",
    "rules",
    "requirements",
    "scopes",
    "buckets",
    "services",
    "pagings",
    "formats",
];

// Catalogues whose uses finalize cannot see: a scalar, array or enum use schema is inlined at each
// use (ADR 0007 section 3) and a requirement expands into each route's `requires`, so the IR never
// holds either entry.
const INLINED_CATALOGUES: [&str; 2] = ["schemas", "requirements"];

const CONVENTIONS_MEMBER: &str = "conventions";

/// One entry of the api's merged catalogues.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineDeclared {
    /// The catalogue name.
    pub catalogue: &'static str,
    /// The entry id.
    pub id: String,
    /// Where the winning layer wrote the entry.
    pub origin: Origin,
    /// Whether an operation, an identity or a convention reaches the entry, through an inlined use
    /// included.
    pub reached: bool,
}

/// Every entry of the api's merged catalogues, in catalogue then key order, with its winning
/// layer's origin and whether `ir`, the finalized IR, reaches it.
///
/// # Errors
///
/// An [`InternalError`] for an entry with no origin.
pub fn pipeline_declared(
    raw: &RawApi,
    ir: &ContractIr,
) -> Result<Vec<PipelineDeclared>, InternalError> {
    let reached_inline = inlined_entries_reached(raw, ir);
    let convention_names = raw
        .merged
        .get(CONVENTIONS_MEMBER)
        .map(strings_of)
        .unwrap_or_default();
    let mut declared = Vec::new();

    for catalogue in DECLARED_CATALOGUES {
        let Some(JsonValue::Object(entries)) = raw.merged.get(catalogue) else {
            continue;
        };

        for id in entries.keys() {
            let origin = pipeline_origin(raw, &pointer_below(&format!("/{catalogue}"), &[id]))
                .ok_or_else(|| {
                    InternalError::new(format!(
                        "the {catalogue} entry {id} of api {} has no origin",
                        raw.name
                    ))
                })?;
            let reached = ir_holds(ir, catalogue, id)
                || convention_names.contains(id)
                || reached_inline.contains(&entry_key(catalogue, id));

            declared.push(PipelineDeclared {
                catalogue,
                id: id.clone(),
                origin,
                reached,
            });
        }
    }

    Ok(declared)
}

// Finalize keeps exactly the entries its reach walk reaches (`finalize/prune.ts`), so the IR holds
// a reached one. The IR has no `requirements` catalogue.
fn ir_holds(ir: &ContractIr, catalogue: &str, id: &str) -> bool {
    match catalogue {
        "schemas" => ir.schemas.contains_key(id),
        "enums" => ir.enums.contains_key(id),
        "scalars" => ir.scalars.contains_key(id),
        "errors" => ir.errors.contains_key(id),
        "natures" => ir.natures.contains_key(id),
        "schemes" => ir.schemes.contains_key(id),
        "headers" => ir.headers.contains_key(id),
        "identities" => ir.identities.contains_key(id),
        "rights" => ir.rights.contains_key(id),
        "rules" => ir.rules.contains_key(id),
        "scopes" => ir.scopes.contains_key(id),
        "buckets" => ir.buckets.contains_key(id),
        "services" => ir.services.contains_key(id),
        "pagings" => ir.pagings.contains_key(id),
        "formats" => ir.formats.contains_key(id),
        _ => false,
    }
}

// A catalogue and an id, as one key of a set.
fn entry_key(catalogue: &str, id: &str) -> (String, String) {
    (catalogue.to_owned(), id.to_owned())
}

// The inlined entries the contract reaches, as entry keys: an entry is reached when its id is a
// string value of a reached part of the raw tree, which is every member outside the catalogues,
// every entry the IR holds and every inlined entry reached, to a fixed point. A docs or example
// string equal to an id also counts as a use.
fn inlined_entries_reached(raw: &RawApi, ir: &ContractIr) -> HashSet<(String, String)> {
    let mut reached = HashSet::new();
    let mut pending: Vec<&JsonValue> = Vec::new();

    for (member, value) in &raw.merged {
        if !DECLARED_CATALOGUES.contains(&member.as_str()) {
            pending.push(value);
            continue;
        }

        let JsonValue::Object(entries) = value else {
            continue;
        };

        for (id, entry) in entries {
            if ir_holds(ir, member, id) {
                pending.push(entry);
            }
        }
    }

    while let Some(next) = pending.pop() {
        for name in strings_of(next) {
            pending.extend(newly_reached_entries(raw, &name, &mut reached));
        }
    }

    reached
}

// The raw values of the inlined entries `name` names that were not reached yet, marked reached.
fn newly_reached_entries<'raw>(
    raw: &'raw RawApi,
    name: &str,
    reached: &mut HashSet<(String, String)>,
) -> Vec<&'raw JsonValue> {
    let mut values = Vec::new();

    for catalogue in INLINED_CATALOGUES {
        let Some(JsonValue::Object(entries)) = raw.merged.get(catalogue) else {
            continue;
        };
        let Some(entry) = entries.get(name) else {
            continue;
        };

        if reached.insert(entry_key(catalogue, name)) {
            values.push(entry);
        }
    }

    values
}

/// Every string value under `value`, keys excluded.
fn strings_of(value: &JsonValue) -> HashSet<String> {
    let mut strings = HashSet::new();
    let mut pending = vec![value];

    while let Some(next) = pending.pop() {
        match next {
            JsonValue::String(text) => {
                strings.insert(text.clone());
            }
            JsonValue::Array(items) => pending.extend(items),
            JsonValue::Object(object) => pending.extend(object.values()),
            _ => {}
        }
    }

    strings
}
