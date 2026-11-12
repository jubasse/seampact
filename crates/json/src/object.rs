//! A JSON object whose members iterate in JavaScript's own-key order.

use indexmap::IndexMap;
use seampact_js::array_index_value;

use crate::JsonValue;

/// A JSON object that keeps JavaScript's own-key order on every insert.
///
/// Array-index keys (`"0"`, `"200"`) come first in ascending value, then the other keys in
/// insertion order, as `Object.keys` lists them for an object built by `JSON.parse` or by
/// assignment. Replacing a member keeps its place. Equality ignores order, as two JavaScript
/// objects with the same members are deep-equal.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JsonObject(IndexMap<String, JsonValue>);

impl JsonObject {
    /// An empty object.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `key` to `value` and returns the value it replaces.
    ///
    /// A new array-index key goes before every named key and every larger index; a new named
    /// key goes last; an existing key keeps its place.
    pub fn insert(&mut self, key: String, value: JsonValue) -> Option<JsonValue> {
        if let Some(current_value) = self.0.get_mut(&key) {
            return Some(std::mem::replace(current_value, value));
        }

        let Some(new_index) = array_index_value(&key) else {
            self.0.insert(key, value);

            return None;
        };

        let position = self
            .0
            .keys()
            .position(|existing_key| {
                array_index_value(existing_key).is_none_or(|index| index > new_index)
            })
            .unwrap_or(self.0.len());

        self.0.shift_insert(position, key, value);

        None
    }

    /// The value of `key`, if present.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&JsonValue> {
        self.0.get(key)
    }

    /// The value of `key` to change in place, if present.
    #[must_use]
    pub fn get_mut(&mut self, key: &str) -> Option<&mut JsonValue> {
        self.0.get_mut(key)
    }

    /// Whether the object has a member named `key`.
    #[must_use]
    pub fn contains_key(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }

    /// Removes `key` and returns its value; the other members keep their order, as `delete` does.
    pub fn remove(&mut self, key: &str) -> Option<JsonValue> {
        self.0.shift_remove(key)
    }

    /// The number of members.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the object has no member.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The members in JavaScript's own-key order.
    #[must_use]
    pub fn iter(&self) -> indexmap::map::Iter<'_, String, JsonValue> {
        self.0.iter()
    }

    /// The member names in JavaScript's own-key order.
    #[must_use]
    pub fn keys(&self) -> indexmap::map::Keys<'_, String, JsonValue> {
        self.0.keys()
    }

    /// The member values in JavaScript's own-key order.
    #[must_use]
    pub fn values(&self) -> indexmap::map::Values<'_, String, JsonValue> {
        self.0.values()
    }
}

impl FromIterator<(String, JsonValue)> for JsonObject {
    /// Inserts each member in turn, so the result has JavaScript's own-key order.
    fn from_iter<I: IntoIterator<Item = (String, JsonValue)>>(members: I) -> Self {
        let mut object = Self::new();

        object.extend(members);

        object
    }
}

impl Extend<(String, JsonValue)> for JsonObject {
    fn extend<I: IntoIterator<Item = (String, JsonValue)>>(&mut self, members: I) {
        for (key, value) in members {
            self.insert(key, value);
        }
    }
}

impl IntoIterator for JsonObject {
    type Item = (String, JsonValue);
    type IntoIter = indexmap::map::IntoIter<String, JsonValue>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'object> IntoIterator for &'object JsonObject {
    type Item = (&'object String, &'object JsonValue);
    type IntoIter = indexmap::map::Iter<'object, String, JsonValue>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object_of(keys: &[&str]) -> JsonObject {
        keys.iter()
            .map(|key| ((*key).to_owned(), JsonValue::Null))
            .collect()
    }

    fn keys_of(object: &JsonObject) -> Vec<&str> {
        object.keys().map(String::as_str).collect()
    }

    #[test]
    fn array_index_keys_go_first_in_ascending_order() {
        let object = object_of(&["b", "200", "a", "10", "0"]);

        assert_eq!(keys_of(&object), ["0", "10", "200", "b", "a"]);
    }

    #[test]
    fn keys_that_only_look_numeric_keep_insertion_order() {
        let object = object_of(&["b", "01", "-1", "4294967295", "1.0", "7"]);

        assert_eq!(
            keys_of(&object),
            ["7", "b", "01", "-1", "4294967295", "1.0"]
        );
    }

    #[test]
    fn replacing_a_member_keeps_its_place() {
        let mut object = object_of(&["b", "a"]);
        let replaced = object.insert("b".to_owned(), JsonValue::Bool(true));

        assert_eq!(replaced, Some(JsonValue::Null));
        assert_eq!(keys_of(&object), ["b", "a"]);
        assert_eq!(object.get("b"), Some(&JsonValue::Bool(true)));
    }

    #[test]
    fn removing_a_member_keeps_the_order_of_the_others() {
        let mut object = object_of(&["c", "b", "a"]);

        assert_eq!(object.remove("b"), Some(JsonValue::Null));
        assert_eq!(keys_of(&object), ["c", "a"]);
    }

    #[test]
    fn equality_ignores_member_order() {
        assert_eq!(object_of(&["a", "b"]), object_of(&["b", "a"]));
        assert_ne!(object_of(&["a"]), object_of(&["a", "b"]));
    }
}
