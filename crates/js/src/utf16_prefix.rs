//! `text.slice(0, units)`: the first UTF-16 code units of a string.

use std::borrow::Cow;

/// The first `units` UTF-16 code units of `text`, as `text.slice(0, units)` gives them.
///
/// A cut inside a surrogate pair keeps a lone high surrogate in JavaScript, which a Rust string
/// cannot hold; it is written as U+FFFD, the character Node prints for it.
#[must_use]
pub fn utf16_prefix(text: &str, units: usize) -> Cow<'_, str> {
    let mut kept_units = 0;

    for (offset, character) in text.char_indices() {
        let character_units = character.len_utf16();

        if kept_units + character_units > units {
            let Some(kept) = text.get(..offset) else {
                return Cow::Borrowed(text);
            };

            if kept_units < units {
                return Cow::Owned(format!("{kept}{}", char::REPLACEMENT_CHARACTER));
            }

            return Cow::Borrowed(kept);
        }

        kept_units += character_units;
    }

    Cow::Borrowed(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_within_the_bound_is_kept_whole() {
        assert_eq!(utf16_prefix("abc", 3), "abc");
        assert_eq!(utf16_prefix("abc", 10), "abc");
        assert_eq!(utf16_prefix("", 0), "");
    }

    #[test]
    fn the_cut_counts_utf16_units_not_bytes_or_characters() {
        assert_eq!(utf16_prefix("\u{E9}\u{E9}\u{E9}", 2), "\u{E9}\u{E9}");
        assert_eq!(utf16_prefix("\u{1F600}\u{1F600}x", 4), "\u{1F600}\u{1F600}");
    }

    #[test]
    fn a_cut_inside_a_surrogate_pair_writes_a_replacement_character() {
        assert_eq!(utf16_prefix("a\u{1F600}b", 2), "a\u{FFFD}");
        assert_eq!(utf16_prefix("\u{1F600}", 1), "\u{FFFD}");
        assert_eq!(utf16_prefix("\u{1F600}", 0), "");
    }
}
