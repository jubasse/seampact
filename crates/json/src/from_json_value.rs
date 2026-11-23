//! Reads a [`JsonValue`] into any serde type, with the pointer of what failed.

use std::slice;

use indexmap::map;
use serde::de::value::BorrowedStrDeserializer;
use serde::de::{
    DeserializeOwned, DeserializeSeed, Deserializer, EnumAccess, Error as _, IntoDeserializer,
    MapAccess, SeqAccess, Unexpected, VariantAccess, Visitor,
};

use crate::value::WHOLE_INTEGER_RANGE;
use crate::{JsonNumber, JsonReadError, JsonValue};

/// Reads `value` as a `T`, the way `serde_json::from_value` reads a `serde_json::Value`, with no
/// copy of the value.
///
/// A number reads as `serde_json` reads what [`JsonValue`]'s `Serialize` writes: an integral value
/// within 2^53 as an integer, an exact wide integer as an integer when it fits 64 bits, any
/// other as a float.
///
/// # Errors
///
/// [`JsonReadError`] naming the JSON pointer of the first value `T` refuses.
pub fn from_json_value<T: DeserializeOwned>(value: &JsonValue) -> Result<T, JsonReadError> {
    T::deserialize(value)
}

impl<'de> Deserializer<'de> for &'de JsonValue {
    type Error = JsonReadError;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, JsonReadError> {
        match self {
            JsonValue::Null => visitor.visit_unit(),
            JsonValue::Bool(flag) => visitor.visit_bool(*flag),
            JsonValue::Number(number) => visit_number(number, visitor),
            JsonValue::String(text) => visitor.visit_borrowed_str(text),
            JsonValue::Array(items) => visitor.visit_seq(JsonItems {
                items: items.iter(),
                index: 0,
            }),
            JsonValue::Object(members) => visitor.visit_map(JsonMembers {
                members: members.iter(),
                pending: None,
            }),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, JsonReadError> {
        match self {
            JsonValue::Null => visitor.visit_none(),
            other => visitor.visit_some(other),
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> Result<V::Value, JsonReadError> {
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, JsonReadError> {
        match self {
            JsonValue::String(variant) => {
                visitor.visit_enum(BorrowedStrDeserializer::new(variant.as_str()))
            }
            JsonValue::Object(members) if members.len() == 1 => {
                let Some((variant, value)) = members.iter().next() else {
                    return Err(JsonReadError::custom("an enum object with no member"));
                };

                visitor.visit_enum(JsonVariant { variant, value })
            }
            other => Err(JsonReadError::invalid_type(
                unexpected(other),
                &"a variant name or an object with one variant",
            )),
        }
    }

    // A struct reads from an object only, as JavaScript options do: serde's own derive would also
    // accept an array.
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, JsonReadError> {
        self.deserialize_map(visitor)
    }

    fn deserialize_map<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, JsonReadError> {
        match self {
            JsonValue::Object(_) => self.deserialize_any(visitor),
            other => Err(JsonReadError::invalid_type(unexpected(other), &visitor)),
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit
        unit_struct seq tuple tuple_struct identifier ignored_any
    }
}

fn visit_number<'de, V: Visitor<'de>>(
    number: &JsonNumber,
    visitor: V,
) -> Result<V::Value, JsonReadError> {
    if let Some(digits) = number.exact_digits() {
        if let Ok(integer) = digits.parse::<i64>() {
            return visitor.visit_i64(integer);
        }

        if let Ok(integer) = digits.parse::<u64>() {
            return visitor.visit_u64(integer);
        }

        return visitor.visit_f64(number.to_f64());
    }

    match number.integer_within(&WHOLE_INTEGER_RANGE) {
        Some(integer) => visitor.visit_i64(integer),
        None => visitor.visit_f64(number.to_f64()),
    }
}

fn unexpected(value: &JsonValue) -> Unexpected<'_> {
    match value {
        JsonValue::Null => Unexpected::Unit,
        JsonValue::Bool(flag) => Unexpected::Bool(*flag),
        JsonValue::Number(number) => Unexpected::Float(number.to_f64()),
        JsonValue::String(text) => Unexpected::Str(text),
        JsonValue::Array(_) => Unexpected::Seq,
        JsonValue::Object(_) => Unexpected::Map,
    }
}

struct JsonItems<'de> {
    items: slice::Iter<'de, JsonValue>,
    index: usize,
}

impl<'de> SeqAccess<'de> for JsonItems<'de> {
    type Error = JsonReadError;

    fn next_element_seed<Seed: DeserializeSeed<'de>>(
        &mut self,
        seed: Seed,
    ) -> Result<Option<Seed::Value>, JsonReadError> {
        let Some(item) = self.items.next() else {
            return Ok(None);
        };
        let index = self.index;

        self.index += 1;

        seed.deserialize(item)
            .map(Some)
            .map_err(|error| error.below(&index.to_string()))
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.items.len())
    }
}

struct JsonMembers<'de> {
    members: map::Iter<'de, String, JsonValue>,
    pending: Option<(&'de str, &'de JsonValue)>,
}

impl<'de> MapAccess<'de> for JsonMembers<'de> {
    type Error = JsonReadError;

    fn next_key_seed<Seed: DeserializeSeed<'de>>(
        &mut self,
        seed: Seed,
    ) -> Result<Option<Seed::Value>, JsonReadError> {
        let Some((key, value)) = self.members.next() else {
            return Ok(None);
        };

        self.pending = Some((key, value));

        seed.deserialize(BorrowedStrDeserializer::new(key))
            .map(Some)
    }

    fn next_value_seed<Seed: DeserializeSeed<'de>>(
        &mut self,
        seed: Seed,
    ) -> Result<Seed::Value, JsonReadError> {
        let Some((key, value)) = self.pending.take() else {
            return Err(JsonReadError::custom("a member value with no key"));
        };

        seed.deserialize(value).map_err(|error| error.below(key))
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.members.len())
    }
}

/// An enum written as `{ "<variant>": <value> }`.
struct JsonVariant<'de> {
    variant: &'de str,
    value: &'de JsonValue,
}

impl<'de> EnumAccess<'de> for JsonVariant<'de> {
    type Error = JsonReadError;
    type Variant = Self;

    fn variant_seed<Seed: DeserializeSeed<'de>>(
        self,
        seed: Seed,
    ) -> Result<(Seed::Value, Self), JsonReadError> {
        let variant = seed.deserialize(self.variant.into_deserializer())?;

        Ok((variant, self))
    }
}

impl<'de> VariantAccess<'de> for JsonVariant<'de> {
    type Error = JsonReadError;

    fn unit_variant(self) -> Result<(), JsonReadError> {
        match self.value {
            JsonValue::Null => Ok(()),
            other => Err(
                JsonReadError::invalid_type(unexpected(other), &"a unit variant")
                    .below(self.variant),
            ),
        }
    }

    fn newtype_variant_seed<Seed: DeserializeSeed<'de>>(
        self,
        seed: Seed,
    ) -> Result<Seed::Value, JsonReadError> {
        seed.deserialize(self.value)
            .map_err(|error| error.below(self.variant))
    }

    fn tuple_variant<V: Visitor<'de>>(
        self,
        _length: usize,
        visitor: V,
    ) -> Result<V::Value, JsonReadError> {
        self.value
            .deserialize_seq(visitor)
            .map_err(|error| error.below(self.variant))
    }

    fn struct_variant<V: Visitor<'de>>(
        self,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, JsonReadError> {
        self.value
            .deserialize_map(visitor)
            .map_err(|error| error.below(self.variant))
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;
    use crate::JsonReadKind;

    fn parsed(text: &str) -> JsonValue {
        let value: serde_json::Value = serde_json::from_str(text).unwrap();

        JsonValue::try_from(value).unwrap()
    }

    #[derive(Debug, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Outer {
        #[serde(default)]
        names: Vec<String>,
        #[serde(default)]
        inner: Option<Inner>,
        #[serde(default)]
        style: Option<Style>,
    }

    #[derive(Debug, Deserialize, PartialEq)]
    #[serde(deny_unknown_fields)]
    struct Inner {
        count: u8,
    }

    #[derive(Debug, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    enum Style {
        Plain,
        Named { label: String },
        Wrapped(u32),
    }

    #[test]
    fn it_reads_what_serde_json_reads() {
        let text =
            r#"{"names": ["a", "b"], "inner": {"count": 4}, "style": {"named": {"label": "x"}}}"#;
        let ours: Outer = from_json_value(&parsed(text)).unwrap();
        let theirs: Outer = serde_json::from_str(text).unwrap();

        assert_eq!(ours, theirs);
    }

    #[test]
    fn it_reads_an_integral_float_as_an_integer_as_javascript_does() {
        let inner: Inner = from_json_value(&parsed(r#"{"count": 4.0}"#)).unwrap();

        assert_eq!(inner, Inner { count: 4 });
    }

    #[test]
    fn it_reads_every_enum_form() {
        let plain: Style = from_json_value(&parsed(r#""plain""#)).unwrap();
        let wrapped: Style = from_json_value(&parsed(r#"{"wrapped": 7}"#)).unwrap();

        assert_eq!(plain, Style::Plain);
        assert_eq!(wrapped, Style::Wrapped(7));
    }

    #[test]
    fn a_struct_is_read_from_an_object_only() {
        let error = from_json_value::<Inner>(&parsed("[4]")).unwrap_err();

        assert_eq!(error.pointer, "");
        assert_eq!(error.kind, JsonReadKind::Invalid);
    }

    #[test]
    fn it_names_the_pointer_of_a_wrong_value() {
        let error = from_json_value::<Outer>(&parsed(r#"{"names": ["a", 3]}"#)).unwrap_err();

        assert_eq!(error.pointer, "/names/1");
        assert_eq!(error.kind, JsonReadKind::Invalid);
    }

    #[test]
    fn it_names_the_pointer_of_an_unknown_member() {
        let error =
            from_json_value::<Outer>(&parsed(r#"{"inner": {"count": 1, "a/b": 2}}"#)).unwrap_err();

        assert_eq!(error.pointer, "/inner/a~1b");
        assert_eq!(error.kind, JsonReadKind::UnknownMember);
    }

    #[test]
    fn it_refuses_a_number_that_does_not_fit() {
        let error = from_json_value::<Outer>(&parsed(r#"{"inner": {"count": 300}}"#)).unwrap_err();

        assert_eq!(error.pointer, "/inner/count");
    }
}
