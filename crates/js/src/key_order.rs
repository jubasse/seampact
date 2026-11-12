//! The key order JavaScript gives `Object.keys`, `for...in`, `Object.entries` and `JSON.stringify`.

/// The largest array index, 2^32 - 2: ECMAScript caps an array length at 2^32 - 1.
pub const MAX_ARRAY_INDEX: u32 = u32::MAX - 1;

/// The longest canonical decimal of a `u32`.
const MAX_ARRAY_INDEX_DIGITS: usize = 10;

/// Where a key goes in JavaScript key order: array indices first by value, then the others.
///
/// The variant order is the sort order; a stable sort keeps the named keys in insertion order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum KeyRank {
    ArrayIndex(u32),
    Named,
}

impl KeyRank {
    fn of(key: &str) -> Self {
        array_index_value(key).map_or(Self::Named, Self::ArrayIndex)
    }
}

/// The value of `key` when JavaScript treats it as an array index, else `None`.
///
/// An array index is the canonical decimal text of an integer from 0 to [`MAX_ARRAY_INDEX`]:
/// `"01"`, `"-1"`, `"+1"`, `"1.0"`, `""` and `"4294967295"` are not.
#[must_use]
pub fn array_index_value(key: &str) -> Option<u32> {
    let has_only_digits = !key.is_empty() && key.bytes().all(|byte| byte.is_ascii_digit());
    let has_leading_zero = key.len() > 1 && key.starts_with('0');

    if !has_only_digits || has_leading_zero || key.len() > MAX_ARRAY_INDEX_DIGITS {
        return None;
    }

    let value: u64 = key.parse().ok()?;
    let index = u32::try_from(value).ok()?;

    (index <= MAX_ARRAY_INDEX).then_some(index)
}

/// The entries of an insertion-ordered map in JavaScript key order.
///
/// Takes what iterating a `serde_json::Map` (built with `preserve_order`) or an
/// `IndexMap<String, _>` yields, owned or borrowed: array-index keys come first in
/// ascending value, then the other keys in the order given.
pub fn js_key_order<K, V>(entries: impl IntoIterator<Item = (K, V)>) -> impl Iterator<Item = (K, V)>
where
    K: AsRef<str>,
{
    let mut ordered: Vec<(K, V)> = entries.into_iter().collect();

    ordered.sort_by_key(|(key, _)| KeyRank::of(key.as_ref()));

    ordered.into_iter()
}

/// Reorders an insertion-ordered map in place into JavaScript key order.
///
/// Works on `serde_json::Map` (built with `preserve_order`) and `IndexMap<String, _>`, so
/// that iterating the map gives the order JavaScript would. It orders one object; the
/// canonical writer applies it to each object it writes.
pub fn reorder_in_js_key_order<M: InsertionOrderedMap>(map: &mut M) {
    map.reorder_entries_in_js_key_order();
}

/// A map that iterates in insertion order, so that reordering it is visible.
///
/// Sealed: a `BTreeMap` or a `HashMap` would silently stay in byte or random order.
pub trait InsertionOrderedMap: private::Sealed {
    #[doc(hidden)]
    fn reorder_entries_in_js_key_order(&mut self);
}

mod private {
    pub trait Sealed {}

    impl<V, S> Sealed for indexmap::IndexMap<String, V, S> {}

    impl Sealed for serde_json::Map<String, serde_json::Value> {}
}

impl<V, S> InsertionOrderedMap for indexmap::IndexMap<String, V, S> {
    fn reorder_entries_in_js_key_order(&mut self) {
        self.sort_by(|left_key, _, right_key, _| {
            KeyRank::of(left_key).cmp(&KeyRank::of(right_key))
        });
    }
}

impl InsertionOrderedMap for serde_json::Map<String, serde_json::Value> {
    fn reorder_entries_in_js_key_order(&mut self) {
        let entries = std::mem::take(self);

        self.extend(js_key_order(entries));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use serde_json::{Value, json};

    #[test]
    fn canonical_decimal_keys_are_array_indices() {
        assert_eq!(array_index_value("0"), Some(0));
        assert_eq!(array_index_value("200"), Some(200));
        assert_eq!(array_index_value("4294967294"), Some(MAX_ARRAY_INDEX));
    }

    #[test]
    fn non_canonical_or_out_of_range_keys_are_not_array_indices() {
        for key in [
            "01",
            "-1",
            "+1",
            "1.0",
            "",
            "4294967295",
            "99999999999",
            " 1",
            "1e3",
            "\u{661}",
        ] {
            assert_eq!(array_index_value(key), None, "key {key:?}");
        }
    }

    #[test]
    fn array_indices_come_first_then_insertion_order() {
        let entries = [("b", 1), ("404", 2), ("a", 3), ("200", 4)];

        let keys: Vec<&str> = js_key_order(entries).map(|(key, _)| key).collect();

        assert_eq!(keys, ["200", "404", "b", "a"]);
    }

    #[test]
    fn edge_keys_keep_insertion_order_among_named_keys() {
        let entries =
            ["4294967295", "01", "4294967294", "-1", "", "+1", "1.0", "7"].map(|key| (key, ()));

        let keys: Vec<&str> = js_key_order(entries).map(|(key, ())| key).collect();

        assert_eq!(
            keys,
            ["7", "4294967294", "4294967295", "01", "-1", "", "+1", "1.0"]
        );
    }

    #[test]
    fn named_keys_keep_insertion_order_beyond_short_slices() {
        // std's unstable sort is an insertion sort on short slices, so only a long input
        // tells a stable sort from an unstable one.
        let named: Vec<String> = (0..64)
            .map(|number| format!("key{:02}", 63 - number))
            .collect();
        let entries: Vec<(String, ())> = named
            .iter()
            .enumerate()
            .flat_map(|(position, name)| [(name.clone(), ()), ((100 - position).to_string(), ())])
            .collect();

        let named_in_order: Vec<String> = js_key_order(entries)
            .map(|(key, ())| key)
            .filter(|key| array_index_value(key).is_none())
            .collect();

        assert_eq!(named_in_order, named);
    }

    #[test]
    fn index_map_keeps_named_keys_in_insertion_order_beyond_short_slices() {
        let named: Vec<String> = (0..64)
            .map(|number| format!("key{:02}", 63 - number))
            .collect();
        let mut map: IndexMap<String, ()> = named
            .iter()
            .enumerate()
            .flat_map(|(position, name)| [(name.clone(), ()), ((100 - position).to_string(), ())])
            .collect();

        reorder_in_js_key_order(&mut map);

        let named_in_order: Vec<String> = map
            .keys()
            .filter(|key| array_index_value(key).is_none())
            .cloned()
            .collect();

        assert_eq!(named_in_order, named);
    }

    #[test]
    fn reorders_an_index_map_in_place() {
        let mut statuses: IndexMap<String, u32> = [("b", 1), ("404", 2), ("a", 3), ("200", 4)]
            .map(|(key, value)| (key.to_owned(), value))
            .into_iter()
            .collect();

        reorder_in_js_key_order(&mut statuses);

        let keys: Vec<&str> = statuses.keys().map(String::as_str).collect();

        assert_eq!(keys, ["200", "404", "b", "a"]);
    }

    #[test]
    fn reordered_json_map_serialises_in_js_key_order() {
        let Value::Object(mut object) = json!({ "b": 1, "404": 2, "a": 3, "200": 4 }) else {
            panic!("json! of an object literal gives an object");
        };

        reorder_in_js_key_order(&mut object);

        // One object: JSON.stringify also reorders nested objects, which the canonical writer does.
        assert_eq!(
            serde_json::to_string(&object).unwrap(),
            r#"{"200":4,"404":2,"b":1,"a":3}"#
        );
    }
}
