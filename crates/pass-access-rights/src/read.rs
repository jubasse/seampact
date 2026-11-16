//! Readers of the merged raw tree for the half.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{Docs, ExtensionKey, ExtensionPrefix, Extensions, IrMap, Origin};
use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue, json_at_object, pointer_segments};

use crate::schema_use::AccessRightsContext;

/// The written `summary` and `description` of a declaration.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AccessRightsDocs {
    pub(crate) summary: Option<String>,
    pub(crate) description: Option<String>,
}

impl From<AccessRightsDocs> for Docs {
    fn from(docs: AccessRightsDocs) -> Self {
        Self {
            summary: docs.summary,
            description: docs.description,
        }
    }
}

/// The value as a mapping; `None` for another type or an absent value.
pub(crate) fn access_rights_object(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// An own member of a raw mapping; `None` when absent or when `object` is no mapping.
pub(crate) fn access_rights_member<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Option<&'raw JsonValue> {
    object?.get(key)
}

/// The value the merged raw tree holds at `pointer`, copied; `None` when it names nothing.
pub(crate) fn access_rights_merged_at(merged: &JsonObject, pointer: &str) -> Option<JsonValue> {
    let segments = pointer_segments(pointer)?;

    if segments.is_empty() {
        return Some(JsonValue::Object(merged.clone()));
    }

    json_at_object(merged, &segments).cloned()
}

/// A string member; `None` when absent or of another type.
pub(crate) fn access_rights_string<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Option<&'raw str> {
    match access_rights_member(object, key) {
        Some(JsonValue::String(text)) => Some(text.as_str()),
        _ => None,
    }
}

/// The strings of a list member, in written order; an empty list when absent.
pub(crate) fn access_rights_strings(object: Option<&JsonObject>, key: &str) -> Vec<String> {
    let Some(JsonValue::Array(items)) = access_rights_member(object, key) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| match item {
            JsonValue::String(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

/// The entries of a mapping member whose values are mappings, in written order.
pub(crate) fn access_rights_entries<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Vec<(&'raw str, &'raw JsonObject)> {
    let Some(catalogue) = access_rights_object(access_rights_member(object, key)) else {
        return Vec::new();
    };

    catalogue
        .iter()
        .filter_map(|(name, value)| {
            access_rights_object(Some(value)).map(|entry| (name.as_str(), entry))
        })
        .collect()
}

/// The prefix and key of an `x-<prefix>-<key>` extension member name; the prefix holds no dash,
/// so the key is everything after it.
fn extension_key_parts(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("x-")?;
    let first = rest.chars().next()?;

    if !first.is_ascii_lowercase() {
        return None;
    }

    let prefix_length = rest
        .find(|character: char| !(character.is_ascii_lowercase() || character.is_ascii_digit()))
        .unwrap_or(rest.len());
    let (prefix, after_prefix) = rest.split_at_checked(prefix_length)?;
    let key = after_prefix.strip_prefix('-')?;
    let has_line_terminator = key.contains(['\n', '\r', '\u{2028}', '\u{2029}']);

    (!key.is_empty() && !has_line_terminator).then_some((prefix, key))
}

/// The written `summary` and `description` of a declaration.
pub(crate) fn access_rights_docs(declaration: &JsonObject) -> AccessRightsDocs {
    AccessRightsDocs {
        summary: access_rights_string(Some(declaration), "summary").map(str::to_owned),
        description: access_rights_string(Some(declaration), "description").map(str::to_owned),
    }
}

/// The extension values written on a declaration (`x-<prefix>-<key>`), copied into the IR slot
/// `{ <prefix>: { <key>: value } }`; the keys of a slot come in JavaScript key order.
pub(crate) fn access_rights_extensions(declaration: &JsonObject) -> Extensions {
    let mut slots: IndexMap<&str, Vec<(String, JsonValue)>> = IndexMap::new();

    for (member, value) in declaration {
        if let Some((prefix, key)) = extension_key_parts(member) {
            slots
                .entry(prefix)
                .or_default()
                .push((key.to_owned(), value.clone()));
        }
    }

    let mut extensions = Extensions::new();

    for (prefix, keys) in slots {
        let mut slot = IrMap::new();

        for (key, value) in js_key_order(keys) {
            slot.insert(ExtensionKey::new(key), value);
        }

        extensions.insert(ExtensionPrefix::new(prefix.to_owned()), slot);
    }

    extensions
}

/// The origin of a node of the merged raw tree the half read.
///
/// # Errors
///
/// An internal error for a pointer with no origin.
pub(crate) fn access_rights_origin_of(
    context: &AccessRightsContext,
    pointer: &str,
) -> Result<Origin, InternalError> {
    context.context.origin(pointer).ok_or_else(|| {
        InternalError::new(format!(
            "access.rights read {pointer}, which has no origin in the merged raw tree"
        ))
    })
}

/// The schema name a written schema position holds (`TaskId`, or `{ $ref: TaskId }`), `None` for
/// an inline schema. Two id positions naming different schemas are different ids, even when both
/// compile to one type use.
pub(crate) fn access_rights_schema_name(value: Option<&JsonValue>) -> Option<String> {
    if let Some(JsonValue::String(name)) = value {
        return Some(name.clone());
    }

    let object = access_rights_object(value)?;
    let reference = access_rights_string(Some(object), "$ref")?;

    (object.len() == 1).then(|| reference.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping_of(members: Vec<(&str, JsonValue)>) -> JsonValue {
        let mut object = JsonObject::new();

        for (key, value) in members {
            object.insert(key.to_owned(), value);
        }

        JsonValue::Object(object)
    }

    fn text(value: &str) -> JsonValue {
        JsonValue::String(value.to_owned())
    }

    #[test]
    fn member_reads_own_keys_and_nothing_from_a_non_mapping() {
        let value = mapping_of(vec![("__proto__", text("own")), ("name", text("x"))]);
        let object = access_rights_object(Some(&value));

        assert_eq!(access_rights_string(object, "__proto__"), Some("own"));
        assert_eq!(access_rights_string(object, "missing"), None);
        assert_eq!(access_rights_member(None, "name"), None);
        assert_eq!(access_rights_string(object, "name"), Some("x"));
    }

    #[test]
    fn entries_keep_written_order_and_skip_non_mappings() {
        let catalogue = mapping_of(vec![
            ("zeta", mapping_of(vec![])),
            ("skip", text("no")),
            ("alpha", mapping_of(vec![])),
        ]);
        let value = mapping_of(vec![("rights", catalogue)]);
        let entries = access_rights_entries(access_rights_object(Some(&value)), "rights");
        let names: Vec<&str> = entries.iter().map(|(name, _)| *name).collect();

        assert_eq!(names, ["zeta", "alpha"]);
    }

    #[test]
    fn extension_keys_split_at_the_first_dash_after_the_prefix() {
        assert_eq!(extension_key_parts("x-acme-flag"), Some(("acme", "flag")));
        assert_eq!(extension_key_parts("x-a1-b-c"), Some(("a1", "b-c")));
        assert_eq!(
            extension_key_parts("x-acme-__proto__"),
            Some(("acme", "__proto__"))
        );

        for refused in [
            "x-acme", "x-acme-", "x-1a-b", "x-Acme-b", "y-acme-b", "x--b", "x-a-b\nc",
        ] {
            assert_eq!(extension_key_parts(refused), None, "member {refused:?}");
        }
    }

    #[test]
    fn extension_values_keep_proto_as_an_own_key_and_integer_keys_first() {
        let declaration = mapping_of(vec![
            ("summary", text("s")),
            ("x-acme-zeta", text("z")),
            ("x-acme-__proto__", text("own")),
            ("x-acme-10", text("ten")),
            ("x-acme-2", text("two")),
            ("x-other-a", text("o")),
        ]);
        let JsonValue::Object(declaration) = declaration else {
            panic!("a mapping expected");
        };
        let extensions = access_rights_extensions(&declaration);
        let prefixes: Vec<&str> = extensions.keys().map(ExtensionPrefix::as_str).collect();
        let acme = extensions.get("acme").unwrap();
        let keys: Vec<&str> = acme.keys().map(ExtensionKey::as_str).collect();

        assert_eq!(prefixes, ["acme", "other"]);
        assert_eq!(keys, ["2", "10", "zeta", "__proto__"]);
        assert_eq!(acme.get("__proto__"), Some(&text("own")));
    }

    #[test]
    fn a_schema_name_is_a_string_or_a_lone_reference() {
        let lone = mapping_of(vec![("$ref", text("TaskId"))]);
        let with_more = mapping_of(vec![("$ref", text("TaskId")), ("type", text("string"))]);

        assert_eq!(
            access_rights_schema_name(Some(&text("TaskId"))),
            Some("TaskId".to_owned())
        );
        assert_eq!(
            access_rights_schema_name(Some(&lone)),
            Some("TaskId".to_owned())
        );
        assert_eq!(access_rights_schema_name(Some(&with_more)), None);
        assert_eq!(access_rights_schema_name(None), None);
    }

    #[test]
    fn the_strings_of_a_list_skip_other_items_and_an_absent_list_is_empty() {
        let value = mapping_of(vec![(
            "errors",
            JsonValue::Array(vec![text("a"), JsonValue::Null, text("b")]),
        )]);
        let object = access_rights_object(Some(&value));

        assert_eq!(access_rights_strings(object, "errors"), ["a", "b"]);
        assert_eq!(
            access_rights_strings(object, "missing"),
            Vec::<String>::new()
        );
    }
}
