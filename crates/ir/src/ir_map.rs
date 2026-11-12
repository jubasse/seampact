//! The IR map: a catalogue or plain map whose keys iterate in JavaScript's own-key order.

use std::borrow::Borrow;
use std::cmp::Ordering;
use std::fmt;
use std::hash::Hash;
use std::marker::PhantomData;
use std::mem;

use indexmap::IndexMap;
use seampact_js::{array_index_value, cmp_utf16, js_key_order};
use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// An IR catalogue (keyed by an id newtype) or plain map (keyed by `String`).
///
/// `insert` keeps JavaScript's own-key order: array-index keys (`"0"`, `"200"`) first in
/// ascending value, then the other keys in insertion order. A decoded map is sorted in IR order
/// ([`IrMap::sort_in_ir_order`]), as the TypeScript reads the IR back from its canonical text.
/// Equality ignores order.
#[derive(Clone)]
pub struct IrMap<K, V>(IndexMap<K, V>);

impl<K, V> IrMap<K, V> {
    /// An empty map.
    #[must_use]
    pub fn new() -> Self {
        Self(IndexMap::new())
    }

    /// The number of entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the map has no entry.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The entries in iteration order.
    #[must_use]
    pub fn iter(&self) -> indexmap::map::Iter<'_, K, V> {
        self.0.iter()
    }

    /// The keys in iteration order.
    #[must_use]
    pub fn keys(&self) -> indexmap::map::Keys<'_, K, V> {
        self.0.keys()
    }

    /// The values in iteration order.
    #[must_use]
    pub fn values(&self) -> indexmap::map::Values<'_, K, V> {
        self.0.values()
    }
}

impl<K: AsRef<str> + Hash + Eq, V> IrMap<K, V> {
    /// Sets `key` to `value` and returns the value it replaces.
    ///
    /// A new array-index key goes before every named key and every larger index; a new named
    /// key goes last; an existing key keeps its place.
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        if let Some(current_value) = self.0.get_mut(&key) {
            return Some(mem::replace(current_value, value));
        }

        let is_array_index = array_index_value(key.as_ref()).is_some();

        self.0.insert(key, value);

        if is_array_index {
            self.0 = js_key_order(mem::take(&mut self.0)).collect();
        }

        None
    }

    /// The value of `key`, if present.
    #[must_use]
    pub fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.get(key)
    }

    /// Whether `key` is present.
    #[must_use]
    pub fn contains_key<Q>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.contains_key(key)
    }

    /// Sorts the entries in IR order: array-index keys first in ascending value, then the other
    /// keys by UTF-16 code units, the order of the map read back from canonical IR text.
    pub fn sort_in_ir_order(&mut self) {
        self.0
            .sort_by(|left, _, right, _| ir_key_order(left.as_ref(), right.as_ref()));
    }
}

fn ir_key_order(left: &str, right: &str) -> Ordering {
    match (array_index_value(left), array_index_value(right)) {
        (Some(left_index), Some(right_index)) => left_index.cmp(&right_index),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => cmp_utf16(left, right),
    }
}

impl<K, V> Default for IrMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: fmt::Debug, V: fmt::Debug> fmt::Debug for IrMap<K, V> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_map().entries(self.0.iter()).finish()
    }
}

impl<K: Hash + Eq, V: PartialEq> PartialEq for IrMap<K, V> {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl<K: Hash + Eq, V: Eq> Eq for IrMap<K, V> {}

impl<K: AsRef<str> + Hash + Eq, V> FromIterator<(K, V)> for IrMap<K, V> {
    /// Inserts each entry in turn, so the result has JavaScript's own-key order.
    fn from_iter<I: IntoIterator<Item = (K, V)>>(entries: I) -> Self {
        let mut map = Self::new();

        for (key, value) in entries {
            map.insert(key, value);
        }

        map
    }
}

impl<K, V> IntoIterator for IrMap<K, V> {
    type Item = (K, V);
    type IntoIter = indexmap::map::IntoIter<K, V>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'map, K, V> IntoIterator for &'map IrMap<K, V> {
    type Item = (&'map K, &'map V);
    type IntoIter = indexmap::map::Iter<'map, K, V>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl<K: Serialize, V: Serialize> Serialize for IrMap<K, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;

        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }

        map.end()
    }
}

impl<'de, K, V> Deserialize<'de> for IrMap<K, V>
where
    K: Deserialize<'de> + AsRef<str> + Hash + Eq,
    V: Deserialize<'de>,
{
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(IrMapVisitor(PhantomData))
    }
}

struct IrMapVisitor<K, V>(PhantomData<(K, V)>);

impl<'de, K, V> Visitor<'de> for IrMapVisitor<K, V>
where
    K: Deserialize<'de> + AsRef<str> + Hash + Eq,
    V: Deserialize<'de>,
{
    type Value = IrMap<K, V>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut entries: A) -> Result<Self::Value, A::Error> {
        let mut map = IndexMap::new();

        while let Some((key, value)) = entries.next_entry::<K, V>()? {
            // A repeated key keeps its first place and its last value, as `JSON.parse` does.
            map.insert(key, value);
        }

        let mut map = IrMap(map);

        map.sort_in_ir_order();

        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys_of(map: &IrMap<String, i64>) -> Vec<&str> {
        map.keys().map(String::as_str).collect()
    }

    #[test]
    fn insert_puts_array_index_keys_first_and_keeps_the_rest_in_insertion_order() {
        let map: IrMap<String, i64> = ["b", "404", "a", "200", "01"]
            .into_iter()
            .map(|key| (key.to_owned(), 0))
            .collect();

        assert_eq!(keys_of(&map), ["200", "404", "b", "a", "01"]);
    }

    #[test]
    fn replacing_a_value_keeps_its_place() {
        let mut map: IrMap<String, i64> = [("b".to_owned(), 1), ("a".to_owned(), 2)]
            .into_iter()
            .collect();

        assert_eq!(map.insert("b".to_owned(), 3), Some(1));
        assert_eq!(keys_of(&map), ["b", "a"]);
        assert_eq!(map.get("b"), Some(&3));
    }

    #[test]
    fn a_decoded_map_is_in_ir_order_with_utf16_order_behind_the_array_index_keys() {
        // U+FF5E sorts after U+1F600 by code point and before it by UTF-16 code unit.
        let map: IrMap<String, i64> = serde_json::from_str(
            "{\"\u{1F600}\": 1, \"\u{FF5E}\": 2, \"b\": 3, \"10\": 4, \"9\": 5}",
        )
        .unwrap();

        assert_eq!(keys_of(&map), ["9", "10", "b", "\u{1F600}", "\u{FF5E}"]);
    }

    #[test]
    fn equality_ignores_order() {
        let left: IrMap<String, i64> = [("a".to_owned(), 1), ("b".to_owned(), 2)]
            .into_iter()
            .collect();
        let right: IrMap<String, i64> = [("b".to_owned(), 2), ("a".to_owned(), 1)]
            .into_iter()
            .collect();

        assert_eq!(left, right);
    }
}
