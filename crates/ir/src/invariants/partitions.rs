//! The hand-written partitions of the values that decide a struct's members.

/// Value sources that name a member of the request or the principal.
pub(super) const NAMED_SOURCES: &[&str] = &[
    "path",
    "query",
    "header",
    "body",
    "principal",
    "scope",
    "holderField",
];

/// Value sources that name no member.
pub(super) const BARE_SOURCES: &[&str] = &["host", "subdomain", "resolver", "address"];

/// Field wire kinds that carry style, explode and brackets.
pub(super) const QUERY_WIRE_KINDS: &[&str] = &["number", "boolean", "list", "text", "object"];

/// Field wire kinds that carry none of them.
pub(super) const PLAIN_WIRE_KINDS: &[&str] = &["file", "json"];

/// The members only a query wire kind has.
pub(super) const QUERY_WIRE_MEMBERS: &[&str] = &["style", "explode", "brackets"];

/// An id is a scalar or an enum use.
pub(super) const ID_TYPE_KINDS: &[&str] = &["scalar", "enum"];

/// A proof is any use but these.
pub(super) const PROOF_REFUSED_KINDS: &[&str] = &["opaque", "file"];

/// Neither an id nor a refused proof.
pub(super) const OTHER_TYPE_KINDS: &[&str] = &["ref", "array"];

/// Every known type use kind.
pub(super) const KNOWN_TYPE_USE_KINDS: &[&str] =
    &["scalar", "enum", "opaque", "file", "ref", "array"];

/// A body proof is a property beside the input's own, so its input is an object schema.
pub(super) const OBJECT_SCHEMA_KINDS: &[&str] = &["object"];

/// The known schema kinds that are no object.
pub(super) const NON_OBJECT_SCHEMA_KINDS: &[&str] = &["map", "union"];

/// Every known schema kind.
pub(super) const KNOWN_SCHEMA_KINDS: &[&str] = &["object", "map", "union"];

/// The input media whose body is a list of fields, each with a wire form.
pub(super) const FIELD_MEDIA: &[&str] =
    &["application/x-www-form-urlencoded", "multipart/form-data"];

/// The input media of a JSON document.
pub(super) const DOCUMENT_MEDIA: &[&str] = &["application/json"];

/// The catalogues of the declarations the compiler supplies (origin layer `core`).
pub(super) const CORE_CATALOGUES: &[&str] = &["formats", "errors", "schemas"];

/// Each deciding member, as `Definition.member`, with its known values split into disjoint parts.
///
/// A new known value of a deciding member fails the partition test until an invariant decides it.
pub const IR_PARTITIONS: &[(&str, &[&[&str]])] = &[
    ("ValueSource.in", &[NAMED_SOURCES, BARE_SOURCES]),
    ("FieldWire.kind", &[QUERY_WIRE_KINDS, PLAIN_WIRE_KINDS]),
    (
        "TypeUse.kind",
        &[ID_TYPE_KINDS, PROOF_REFUSED_KINDS, OTHER_TYPE_KINDS],
    ),
    ("OperationInput.media", &[FIELD_MEDIA, DOCUMENT_MEDIA]),
    (
        "Schema.kind",
        &[OBJECT_SCHEMA_KINDS, NON_OBJECT_SCHEMA_KINDS],
    ),
];

#[cfg(test)]
mod tests {
    use seampact_json::JsonValue;

    use super::*;
    use crate::invariants::open_values::known_values;
    use crate::union_tags;

    // A tagged union's known list is the tag of each variant; an open enum's is its annotation.
    fn known_of(definition: &str, member: &str) -> Vec<String> {
        if let Some(union) = union_tags(definition) {
            return union
                .known_tags
                .iter()
                .map(|tag| (*tag).to_owned())
                .collect();
        }

        known_values(definition, member)
            .unwrap_or_default()
            .iter()
            .filter_map(|value| match value {
                JsonValue::String(text) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn each_partition_is_a_disjoint_union_of_the_schemas_known_list() {
        for (key, parts) in IR_PARTITIONS {
            let (definition, member) = key.split_once('.').unwrap_or((key, ""));
            let mut flat: Vec<String> = parts
                .iter()
                .flat_map(|part| part.iter().map(|value| (*value).to_owned()))
                .collect();
            let mut known = known_of(definition, member);

            flat.sort();
            known.sort();

            let mut unique = flat.clone();

            unique.dedup();

            assert_eq!(unique.len(), flat.len(), "{key} parts overlap");
            assert_eq!(flat, known, "{key}");
        }
    }
}
