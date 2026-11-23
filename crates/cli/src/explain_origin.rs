//! Where a member of an operation comes from, as `seampact explain` comments it.

use indexmap::IndexMap;
use seampact_json::{JsonValue, is_text, items_of, js_text_of, object_of};
use seampact_span::Location;

use seampact_generate::origin_position;

/// The text of an origin: a core declaration is `built in`, a located one its `file:line`, else
/// its api, layer and pointer.
fn origin_text(origin: &JsonValue, locations: &IndexMap<String, Location>) -> String {
    let JsonValue::Object(object) = origin else {
        return js_text_of(Some(origin));
    };

    if is_text(object.get("layer"), "core") {
        return "built in".to_owned();
    }

    if let Some(position) = origin_position(origin, locations) {
        return position;
    }

    let key = format!(
        "{}#{}",
        js_text_of(object.get("layer")),
        js_text_of(object.get("pointer"))
    );

    match object.get("api") {
        Some(api) => format!("api {}, {key}", js_text_of(Some(api))),
        None => key,
    }
}

/// The derivation and the origins of `value`, each once, joined by commas; empty for a value that
/// is not a mapping or has none.
pub(crate) fn provenance(value: &JsonValue, locations: &IndexMap<String, Location>) -> String {
    let JsonValue::Object(object) = value else {
        return String::new();
    };
    let mut parts: Vec<String> = Vec::new();

    if let Some(derived_from) = object_of(object.get("derivedFrom")) {
        parts.push(js_text_of(derived_from.get("derivation")));

        parts.extend(
            items_of(derived_from.get("from"))
                .iter()
                .map(|origin| origin_text(origin, locations)),
        );
    }

    if let Some(origin) = object.get("origin") {
        parts.push(origin_text(origin, locations));
    }

    let mut distinct: Vec<String> = Vec::with_capacity(parts.len());

    for part in parts {
        if !distinct.contains(&part) {
            distinct.push(part);
        }
    }

    distinct.join(", ")
}
