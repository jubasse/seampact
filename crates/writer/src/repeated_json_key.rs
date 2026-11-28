//! The first key a JSON text repeats inside one object, which a parse into a map would hide.

use std::collections::HashSet;
use std::fmt;

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};

/// The first key `text` repeats within one object, at any depth; `None` when none does or when
/// `text` is not JSON, which the caller's own parse reports.
#[must_use]
pub(crate) fn first_repeated_key(text: &str) -> Option<String> {
    let mut deserializer = serde_json::Deserializer::from_str(text);

    RepeatedKeySearch.deserialize(&mut deserializer).ok()?
}

struct RepeatedKeySearch;

impl<'de> DeserializeSeed<'de> for RepeatedKeySearch {
    type Value = Option<String>;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for RepeatedKeySearch {
    type Value = Option<String>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E>(self, _: bool) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_i64<E>(self, _: i64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_u64<E>(self, _: u64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_f64<E>(self, _: f64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_str<E>(self, _: &str) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut elements: A) -> Result<Self::Value, A::Error> {
        let mut found = None;

        while let Some(inside) = elements.next_element_seed(Self)? {
            found = found.or(inside);
        }

        Ok(found)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut members: A) -> Result<Self::Value, A::Error> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut found = None;

        while let Some(key) = members.next_key::<String>()? {
            let inside = members.next_value_seed(Self)?;

            if found.is_none() && !seen.insert(key.clone()) {
                found = Some(key);
            }

            found = found.or(inside);
        }

        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_first_repeated_key_at_any_depth_and_none_otherwise() {
        assert_eq!(first_repeated_key(r#"{"a":1,"a":2}"#), Some("a".to_owned()));
        assert_eq!(
            first_repeated_key(r#"[{"x":{"b":1,"c":2,"b":3}}]"#),
            Some("b".to_owned())
        );
        assert_eq!(first_repeated_key(r#"{"a":{"a":1},"b":[{"a":2}]}"#), None);
        assert_eq!(first_repeated_key("{not json"), None);
    }
}
