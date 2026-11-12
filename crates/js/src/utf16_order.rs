//! String order by UTF-16 code units, the order of JavaScript `<` and `.sort()`.

use std::cmp::Ordering;
use std::fmt;
use std::hash::{Hash, Hasher};

/// Compares two strings by UTF-16 code units, as JavaScript `<` does, without allocating.
///
/// Rust compares `str` by bytes, which is code-point order: an astral character (a
/// surrogate pair in JavaScript) sorts after U+E000..U+FFFF in Rust and before them here.
#[must_use]
pub fn cmp_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// A string ordered by UTF-16 code units, for `BTreeMap`, `BTreeSet` and `sort_by_key`.
///
/// Wraps an owned (`Utf16Key<String>`) or a borrowed (`Utf16Key<&str>`) string.
/// Equality and hashing compare the text, which agrees with the order.
#[derive(Debug, Clone, Copy, Default)]
pub struct Utf16Key<S>(S);

impl<S: AsRef<str>> Utf16Key<S> {
    /// Wraps a string.
    pub fn new(text: S) -> Self {
        Self(text)
    }

    /// The wrapped text.
    pub fn as_str(&self) -> &str {
        self.0.as_ref()
    }

    /// Unwraps the string.
    pub fn into_inner(self) -> S {
        self.0
    }
}

impl<S: AsRef<str>> PartialEq for Utf16Key<S> {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl<S: AsRef<str>> Eq for Utf16Key<S> {}

impl<S: AsRef<str>> PartialOrd for Utf16Key<S> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<S: AsRef<str>> Ord for Utf16Key<S> {
    fn cmp(&self, other: &Self) -> Ordering {
        cmp_utf16(self.as_str(), other.as_str())
    }
}

impl<S: AsRef<str>> Hash for Utf16Key<S> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

impl<S: AsRef<str>> fmt::Display for Utf16Key<S> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    const ASTRAL: &str = "\u{1F600}";
    const PRIVATE_USE: &str = "\u{E000}";
    const LAST_BMP: &str = "\u{FFFF}";

    #[test]
    fn astral_character_sorts_before_the_top_of_the_bmp() {
        assert_eq!(cmp_utf16(ASTRAL, PRIVATE_USE), Ordering::Less);
        assert_eq!(cmp_utf16(ASTRAL, LAST_BMP), Ordering::Less);
        assert_eq!(cmp_utf16(LAST_BMP, ASTRAL), Ordering::Greater);
        assert_eq!(
            ASTRAL.cmp(PRIVATE_USE),
            Ordering::Greater,
            "byte order differs"
        );
    }

    #[test]
    fn astral_character_sorts_after_bmp_below_the_surrogates() {
        assert_eq!(cmp_utf16("\u{D7FF}", ASTRAL), Ordering::Less);
    }

    #[test]
    fn equal_strings_compare_equal() {
        assert_eq!(cmp_utf16("caf\u{E9}", "caf\u{E9}"), Ordering::Equal);
    }

    #[test]
    fn prefix_sorts_first() {
        assert_eq!(cmp_utf16("user", "users"), Ordering::Less);
        assert_eq!(cmp_utf16("users", "user"), Ordering::Greater);
    }

    #[test]
    fn empty_string_sorts_first() {
        assert_eq!(cmp_utf16("", ""), Ordering::Equal);
        assert_eq!(cmp_utf16("", "a"), Ordering::Less);
    }

    #[test]
    fn ascii_sorts_by_code_unit() {
        assert_eq!(cmp_utf16("B", "a"), Ordering::Less);
        assert_eq!(cmp_utf16("a_b", "aB"), Ordering::Greater);
    }

    #[test]
    fn mixed_bmp_sorts_by_code_unit() {
        assert_eq!(cmp_utf16("z", "\u{E9}"), Ordering::Less);
        assert_eq!(cmp_utf16("\u{E9}t\u{E9}", "\u{4E2D}"), Ordering::Less);
    }

    #[test]
    fn btree_set_of_keys_iterates_in_utf16_order() {
        let keys: BTreeSet<Utf16Key<&str>> = [LAST_BMP, "a", ASTRAL, PRIVATE_USE]
            .into_iter()
            .map(Utf16Key::new)
            .collect();

        let ordered: Vec<&str> = keys.iter().map(Utf16Key::as_str).collect();

        assert_eq!(ordered, ["a", ASTRAL, PRIVATE_USE, LAST_BMP]);
    }

    #[test]
    fn owned_keys_sort_like_borrowed_keys() {
        let mut names = vec![PRIVATE_USE.to_owned(), ASTRAL.to_owned()];

        names.sort_by_key(|name| Utf16Key::new(name.clone()));

        assert_eq!(names, [ASTRAL, PRIVATE_USE]);
    }

    proptest! {
        #[test]
        fn agrees_with_comparing_encoded_units(left in any::<String>(), right in any::<String>()) {
            let left_units: Vec<u16> = left.encode_utf16().collect();
            let right_units: Vec<u16> = right.encode_utf16().collect();

            prop_assert_eq!(cmp_utf16(&left, &right), left_units.cmp(&right_units));
        }
    }
}
