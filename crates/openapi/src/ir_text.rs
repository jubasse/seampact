//! The IR's own text forms: origins, value sources and derivations as a document writes them.

use seampact_ir::{DerivedFrom, Origin, ValueSource, ValueSourceIn};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::emit_context::{EmitContext, refuse_inconsistent};

/// An origin as the text `[<api>#]<layer>#<pointer>`.
///
/// An origin copied from another api leads with it and `#`, which no layer holds, so `pack:<name>`
/// layers stay unambiguous.
pub(crate) fn origin_key(origin: &Origin) -> String {
    let key = format!("{}#{}", origin.layer, origin.pointer);

    match &origin.api {
        Some(api) => format!("{api}#{key}"),
        None => key,
    }
}

/// A value source as the grammar writes it: `path.taskId`, `scope.channel`, `host`, `address/64`.
pub(crate) fn value_source_text(
    context: &mut EmitContext<'_>,
    source: &ValueSource,
    location: &IrLocation,
) -> String {
    let place = source.r#in.as_str();

    match (&source.r#in, &source.name) {
        (ValueSourceIn::Address, _) => source
            .prefix_bits
            .map_or_else(|| place.to_owned(), |bits| format!("{place}/{bits}")),
        (ValueSourceIn::Host | ValueSourceIn::Subdomain | ValueSourceIn::Resolver, _) => {
            place.to_owned()
        }
        (_, Some(name)) => format!("{place}.{name}"),
        (_, None) => {
            refuse_inconsistent(
                context,
                "value-source.name",
                &format!("A value source in '{place}' without its name"),
                &location.below(&["name"]),
            );

            place.to_owned()
        }
    }
}

/// `{ derivation, from }`, the value of `x-seampact-derived-from`.
pub(crate) fn derived_from_value(derived_from: &DerivedFrom) -> JsonObject {
    let from = derived_from
        .from
        .iter()
        .map(|origin| JsonValue::text(&origin_key(origin)))
        .collect();

    JsonObject::from_iter([
        (
            "derivation".to_owned(),
            JsonValue::text(derived_from.derivation.as_str()),
        ),
        ("from".to_owned(), JsonValue::Array(from)),
    ])
}

#[cfg(test)]
mod tests {
    use seampact_ir::Layer;

    use super::*;

    fn origin(api: Option<&str>, layer: Layer, pointer: &str) -> Origin {
        Origin {
            api: api.map(str::to_owned),
            layer,
            pointer: pointer.to_owned(),
        }
    }

    #[test]
    fn an_origin_copied_from_another_api_leads_with_it_apart_from_a_pack_layer() {
        let pack = Layer::Pack(seampact_ir::PackName::new("api".to_owned()));

        assert_eq!(origin_key(&origin(None, pack, "/x")), "pack:api#/x");
        assert_eq!(
            origin_key(&origin(Some("pack"), Layer::Api, "/x")),
            "pack#api#/x"
        );
    }
}
