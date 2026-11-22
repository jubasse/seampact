//! A value with every object's members in the canonical document order of the IR.

use seampact_json::{JsonValue, canonical_document};

/// The value as a document file holds it once read: every object's members sorted by UTF-16 code
/// units, which `JSON.parse` of the file keeps.
///
/// The TypeScript compiler writes the IR in that order, so a view built from a Rust IR struct
/// (members in schema order) reads it back through this to list members as the TypeScript does.
///
/// # Errors
///
/// The text of the decoding error when the canonical text does not read back.
pub(crate) fn in_document_order(value: &JsonValue) -> Result<JsonValue, String> {
    serde_json::from_str(&canonical_document(value)).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members_are_listed_in_utf16_order_at_every_depth() {
        let value: JsonValue =
            serde_json::from_str(r#"{ "style": 1, "items": [{ "b": 1, "a": 2 }], "Z": 0 }"#)
                .unwrap();
        let ordered = in_document_order(&value).unwrap();

        assert_eq!(
            seampact_json::stringify_json(&ordered),
            r#"{"Z":0,"items":[{"a":2,"b":1}],"style":1}"#
        );
    }
}
