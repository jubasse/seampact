//! JSON Pointers into the merged raw tree (RFC 6901), and the origin of the node a pointer names.

use seampact_authoring::RawApi;
use seampact_ir::Origin;
use seampact_json::{JsonObject, JsonValue, escape_pointer, json_at_object, pointer_segments};

/// Whether `value` is an object (`null` and arrays are not).
#[must_use]
pub const fn is_json_object(value: &JsonValue) -> bool {
    matches!(value, JsonValue::Object(_))
}

/// Whether `value` is a list.
#[must_use]
pub const fn is_json_list(value: &JsonValue) -> bool {
    matches!(value, JsonValue::Array(_))
}

/// The pointer below `base` through `segments`, each escaped.
#[must_use]
pub fn pointer_below(base: &str, segments: &[&str]) -> String {
    let mut pointer = String::from(base);

    for segment in segments {
        pointer.push('/');
        pointer.push_str(&escape_pointer(segment));
    }

    pointer
}

// Whether `pointer` names a node of `object`, the root included.
fn object_names_node(object: &JsonObject, pointer: &str) -> bool {
    match pointer_segments(pointer) {
        None => false,
        Some(segments) if segments.is_empty() => true,
        Some(segments) => json_at_object(object, &segments).is_some(),
    }
}

fn origin_copy(origin: &Origin, pointer: String) -> Origin {
    Origin {
        api: origin.api.clone(),
        layer: origin.layer.clone(),
        pointer,
    }
}

/// The origin of the node `pointer` names in the api's merged raw tree (ADR 0004 section 6), a new
/// value a half may store in the draft; `None` when the pointer names no node.
///
/// - A leaf, a list or a declaration: its own entry of `RawApi::leaf_origins`.
/// - A node inside a list or a declaration: that entry's layer, at the node's pointer.
/// - An object the layers merge by leaf path (a surface, a route, a node's settings): the last
///   layer in application order that writes it, the one whose leaves win (ADR 0002 section 2).
#[must_use]
pub fn pipeline_origin(raw: &RawApi, pointer: &str) -> Option<Origin> {
    if !object_names_node(&raw.merged, pointer) {
        return None;
    }

    let mut at = pointer;
    let mut rest = String::new();

    loop {
        if let Some(origin) = raw.leaf_origins.get(at) {
            return Some(origin_copy(origin, format!("{}{rest}", origin.pointer)));
        }

        let Some((parent, last)) = at.rsplit_once('/') else {
            break;
        };

        rest = format!("/{last}{rest}");
        at = parent;
    }

    raw.layers
        .iter()
        .rev()
        .find(|layer| object_names_node(&layer.tree, pointer))
        .map(|layer| Origin {
            api: None,
            layer: layer.layer.clone().into(),
            pointer: pointer.to_owned(),
        })
}
