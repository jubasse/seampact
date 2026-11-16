//! The rules of the ids that name a catalogue entry and of the origins of the core layer.

use std::collections::HashMap;

use seampact_json::{JsonObject, JsonValue};

use super::json_members::{record, string};
use super::open_values::{Catalogue, CatalogueOwner};
use super::partitions::CORE_CATALOGUES;
use super::violation::{IrInvariantId, Violations};

fn unescape_segment(segment: &str) -> String {
    segment.replace("~1", "/").replace("~0", "~")
}

/// Every member holding a catalogue id names an existing entry. Keys are read exactly: a right may
/// be named `__proto__`.
pub(super) fn check_catalogue_id(
    definition: &str,
    pointer: &str,
    id: &str,
    document: &JsonObject,
    catalogues: &HashMap<String, Catalogue>,
    out: &mut Violations,
) {
    let Some(catalogue) = catalogues.get(definition) else {
        return;
    };
    let owner = match catalogue.owner {
        CatalogueOwner::Document => Some(document),
        CatalogueOwner::Api => record(document.get("api")),
    };
    let entries = record(owner.and_then(|owner| owner.get(&catalogue.member)));

    if entries.is_some_and(|entries| !entries.contains_key(id)) {
        out.fail(
            IrInvariantId::RefResolves,
            pointer,
            format!("'{id}' names no entry of '{}'.", catalogue.member),
        );
    }
}

/// A core origin's pointer starts with its entry of a catalogue (`/errors/api.internal`, or
/// `/errors/api.rate_limited/params` for that code's params schema); only that entry is checked.
/// It has no side-table entry, so the entry must be in this document unless the origin names
/// another api (a relay route's copy, read in that api).
pub(super) fn check_core_origin(
    origin: &JsonObject,
    pointer: &str,
    document: &JsonObject,
    out: &mut Violations,
) {
    let Some(origin_pointer) = string(origin.get("pointer")) else {
        return;
    };

    if !matches!(origin.get("layer"), Some(JsonValue::String(layer)) if layer == "core") {
        return;
    }

    let mut segments = origin_pointer.split('/').skip(1).map(unescape_segment);
    let catalogue = segments.next().unwrap_or_default();
    let id = segments.next();
    let names_entry = CORE_CATALOGUES.contains(&catalogue.as_str()) && id.as_deref() != Some("");

    let (true, Some(id)) = (names_entry, id) else {
        out.fail(
            IrInvariantId::OriginCore,
            pointer,
            format!(
                "A core origin points at an entry of {}: '{origin_pointer}' does not.",
                CORE_CATALOGUES.join(", ")
            ),
        );

        return;
    };
    let entries = record(document.get(&catalogue));

    if !origin.contains_key("api") && entries.is_some_and(|entries| !entries.contains_key(&id)) {
        out.fail(
            IrInvariantId::OriginCore,
            pointer,
            format!("A core origin names '{id}', which is no entry of '{catalogue}'."),
        );
    }
}
