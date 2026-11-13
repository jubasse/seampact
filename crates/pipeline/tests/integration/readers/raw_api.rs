//! A loaded api built from the JSON text of its layers, standing in for the loader.

use indexmap::IndexMap;
use seampact_authoring::{ApiLayer, RawApi, RawLayer};
use seampact_ir::{Layer, Origin};
use seampact_json::{JsonObject, JsonValue};

fn parse_object(text: &str) -> JsonObject {
    match serde_json::from_str::<JsonValue>(text).expect("the layer text is JSON") {
        JsonValue::Object(object) => object,
        other => panic!("the layer text is not an object: {other:?}"),
    }
}

// Objects merge by member, any other value (a list included) is replaced, as the layers merge.
fn merge(target: &mut JsonObject, source: &JsonObject) {
    for (key, value) in source {
        match (target.get_mut(key), value) {
            (Some(JsonValue::Object(inner)), JsonValue::Object(incoming)) => {
                merge(inner, incoming);
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

// The origin of each leaf, list and empty object of a layer: the layer that wrote it last wins.
fn record_origins(
    value: &JsonValue,
    pointer: &str,
    layer: &ApiLayer,
    origins: &mut IndexMap<String, Origin>,
) {
    if let JsonValue::Object(object) = value
        && !object.is_empty()
    {
        for (key, item) in object {
            let child = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));

            record_origins(item, &child, layer, origins);
        }

        return;
    }

    origins.insert(
        pointer.to_owned(),
        Origin {
            api: None,
            layer: Layer::from(layer.clone()),
            pointer: pointer.to_owned(),
        },
    );
}

/// An api named `a` whose layers are given in application order with their JSON text.
pub fn raw_api(layers: &[(ApiLayer, &str)]) -> RawApi {
    let mut merged = JsonObject::new();
    let mut leaf_origins = IndexMap::new();
    let mut raw_layers = Vec::new();

    for (layer, text) in layers {
        let tree = parse_object(text);

        merge(&mut merged, &tree);

        for (key, value) in &tree {
            let pointer = format!("/{key}");

            record_origins(value, &pointer, layer, &mut leaf_origins);
        }

        raw_layers.push(RawLayer {
            layer: layer.clone(),
            file: "layer.yaml".to_owned(),
            tree,
        });
    }

    RawApi {
        name: "a".to_owned(),
        layers: raw_layers,
        merged,
        leaf_origins,
        locations: IndexMap::new(),
        visibility: IndexMap::new(),
    }
}

/// An api of one `api` layer.
pub fn single_layer_api(text: &str) -> RawApi {
    raw_api(&[(ApiLayer::Api, text)])
}

/// The origin of the `api` layer at `pointer`.
pub fn api_origin(pointer: &str) -> Origin {
    Origin {
        api: None,
        layer: Layer::Api,
        pointer: pointer.to_owned(),
    }
}
