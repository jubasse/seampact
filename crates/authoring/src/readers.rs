//! Typed reads of a member of a loaded mapping, as the passes' `typeof` checks read it.

use seampact_json::{JsonNumber, JsonObject, JsonValue};

/// Reads a member of a [`JsonObject`] by the type a pass expects.
///
/// Each reader looks at the object's own members only and returns `None` when the member is
/// absent or of another type, where the TypeScript read `undefined`: a member of an unexpected
/// type never fails the read of the whole input.
pub trait JsonObjectExt {
    /// The member `key`, of any type.
    fn member(&self, key: &str) -> Option<&JsonValue>;

    /// The member `key` when it is a string (`typeof === "string"`).
    fn string(&self, key: &str) -> Option<&str>;

    /// The member `key` when it is a number (`typeof === "number"`); compare it through
    /// [`JsonNumber::to_f64`], as JavaScript does.
    fn number(&self, key: &str) -> Option<&JsonNumber>;

    /// The member `key` when it is `true` or `false`.
    fn boolean(&self, key: &str) -> Option<bool>;

    /// The member `key` when it is a mapping: never `null`, never an array.
    fn object(&self, key: &str) -> Option<&JsonObject>;

    /// The member `key` when it is an array.
    fn array(&self, key: &str) -> Option<&[JsonValue]>;
}

impl JsonObjectExt for JsonObject {
    fn member(&self, key: &str) -> Option<&JsonValue> {
        self.get(key)
    }

    fn string(&self, key: &str) -> Option<&str> {
        match self.member(key)? {
            JsonValue::String(text) => Some(text),
            _ => None,
        }
    }

    fn number(&self, key: &str) -> Option<&JsonNumber> {
        match self.member(key)? {
            JsonValue::Number(number) => Some(number),
            _ => None,
        }
    }

    fn boolean(&self, key: &str) -> Option<bool> {
        match self.member(key)? {
            JsonValue::Bool(value) => Some(*value),
            _ => None,
        }
    }

    fn object(&self, key: &str) -> Option<&JsonObject> {
        match self.member(key)? {
            JsonValue::Object(object) => Some(object),
            _ => None,
        }
    }

    fn array(&self, key: &str) -> Option<&[JsonValue]> {
        match self.member(key)? {
            JsonValue::Array(items) => Some(items),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The object JSON text `text` holds.
    fn object_from(text: &str) -> JsonObject {
        let JsonValue::Object(object) = serde_json::from_str(text).unwrap() else {
            panic!("not an object: {text}");
        };

        object
    }

    /// One member of every JSON type, named after it.
    fn every_type() -> JsonObject {
        object_from(
            r#"{
                "null": null,
                "true": true,
                "false": false,
                "number": 404,
                "string": "text",
                "array": [1, "two"],
                "object": {"inner": 1},
                "empty string": "",
                "empty array": [],
                "empty object": {}
            }"#,
        )
    }

    /// The members each reader accepts; every other member reads as absent.
    const KEYS: [&str; 10] = [
        "null",
        "true",
        "false",
        "number",
        "string",
        "array",
        "object",
        "empty string",
        "empty array",
        "empty object",
    ];

    fn accepted_keys(read: impl Fn(&JsonObject, &str) -> bool) -> Vec<&'static str> {
        let object = every_type();

        KEYS.into_iter().filter(|key| read(&object, key)).collect()
    }

    #[test]
    fn member_reads_every_type_and_absent_is_none() {
        assert_eq!(accepted_keys(|o, k| o.member(k).is_some()), KEYS);
        assert_eq!(every_type().member("null"), Some(&JsonValue::Null));
        assert_eq!(every_type().member("missing"), None);
    }

    #[test]
    fn string_reads_strings_only() {
        let object = every_type();

        assert_eq!(
            accepted_keys(|o, k| o.string(k).is_some()),
            ["string", "empty string"]
        );
        assert_eq!(object.string("string"), Some("text"));
        assert_eq!(object.string("empty string"), Some(""));
    }

    #[test]
    fn number_reads_numbers_only() {
        let object = every_type();

        assert_eq!(accepted_keys(|o, k| o.number(k).is_some()), ["number"]);
        assert_eq!(object.number("number").map(JsonNumber::to_f64), Some(404.0));
    }

    #[test]
    fn boolean_reads_booleans_only() {
        let object = every_type();

        assert_eq!(
            accepted_keys(|o, k| o.boolean(k).is_some()),
            ["true", "false"]
        );
        assert_eq!(object.boolean("true"), Some(true));
        assert_eq!(object.boolean("false"), Some(false));
    }

    #[test]
    fn object_refuses_null_and_arrays() {
        let object = every_type();

        assert_eq!(
            accepted_keys(|o, k| o.object(k).is_some()),
            ["object", "empty object"]
        );
        assert_eq!(object.object("object").map(JsonObject::len), Some(1));
    }

    #[test]
    fn array_reads_arrays_only() {
        let object = every_type();

        assert_eq!(
            accepted_keys(|o, k| o.array(k).is_some()),
            ["array", "empty array"]
        );
        assert_eq!(object.array("array").map(<[JsonValue]>::len), Some(2));
        assert_eq!(object.array("empty array"), Some(&[][..]));
    }

    #[test]
    fn a_numeric_string_key_is_a_key_like_any_other() {
        let object = object_from(r#"{"description": "ok", "404": {"a": 1}, "200": "fine"}"#);

        assert_eq!(object.string("200"), Some("fine"));
        assert!(object.object("404").is_some());
        assert_eq!(object.member("0200"), None);
        assert_eq!(object.member("200.0"), None);
        assert_eq!(
            object.keys().map(String::as_str).collect::<Vec<_>>(),
            ["200", "404", "description"]
        );
    }

    #[test]
    fn keys_match_exactly() {
        let object = object_from(r#"{"é": "accent", "e\u0301": "combining", "😀": 1}"#);

        assert_eq!(object.string("é"), Some("accent"));
        assert_eq!(object.string("e\u{301}"), Some("combining"));
        assert!(object.number("😀").is_some());
        assert_eq!(object.member("E"), None);
    }

    #[test]
    fn a_prototype_name_is_an_own_member_or_absent() {
        let object = object_from(r#"{"constructor": "own"}"#);

        assert_eq!(object.string("constructor"), Some("own"));
        assert_eq!(object.member("__proto__"), None);
        assert_eq!(object.member("toString"), None);
    }

    #[test]
    fn numbers_keep_their_javascript_value() {
        let object =
            object_from(r#"{"negative zero": -0, "tiny": 1e-17, "above 2^53": 9007199254740993}"#);
        let negative_zero = object.number("negative zero").unwrap();
        let tiny = object.number("tiny").unwrap();
        let above_two_pow_53 = object.number("above 2^53").unwrap();

        assert_eq!(negative_zero.to_f64(), 0.0);
        assert!(negative_zero.is_integer());
        assert!(!tiny.is_integer());
        assert_eq!(above_two_pow_53.exact_digits(), Some("9007199254740993"));
        assert_eq!(above_two_pow_53.to_f64(), 9_007_199_254_740_992.0);
    }
}
