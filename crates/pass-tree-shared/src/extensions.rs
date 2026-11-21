//! The `x-<prefix>-<key>` extension member names every half reads the same way.

/// The prefix and the key of `x-<prefix>-<key>` (`^x-([a-z][a-z0-9]*)-(.+)$`): the prefix holds no
/// dash, so the key is everything after it, and `.` matches no line terminator.
#[must_use]
pub fn extension_key_parts(written: &str) -> Option<(&str, &str)> {
    let (prefix, key) = written.strip_prefix("x-")?.split_once('-')?;
    let mut prefix_characters = prefix.chars();
    let prefix_is_word = prefix_characters
        .next()
        .is_some_and(|first| first.is_ascii_lowercase())
        && prefix_characters.all(|next| next.is_ascii_lowercase() || next.is_ascii_digit());
    let key_has_terminator = key.chars().any(is_line_terminator);

    (prefix_is_word && !key.is_empty() && !key_has_terminator).then_some((prefix, key))
}

fn is_line_terminator(character: char) -> bool {
    matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

#[cfg(test)]
mod tests {
    use super::extension_key_parts;

    #[test]
    fn an_extension_key_splits_at_the_first_dash_after_a_lowercase_prefix() {
        assert_eq!(extension_key_parts("x-acme-flag"), Some(("acme", "flag")));
        assert_eq!(extension_key_parts("x-a1-b-c"), Some(("a1", "b-c")));
        assert_eq!(
            extension_key_parts("x-acme-__proto__"),
            Some(("acme", "__proto__"))
        );
        assert_eq!(
            extension_key_parts("x-acme-\u{1F600}"),
            Some(("acme", "\u{1F600}"))
        );
    }

    #[test]
    fn a_member_that_is_no_extension_key_has_no_parts() {
        for refused in [
            "x-acme",
            "x-acme-",
            "x-1a-b",
            "x-Acme-b",
            "y-acme-b",
            "x--b",
            "acme-flag",
            "x-acme-a\nb",
            "x-acme-a\u{2028}",
        ] {
            assert_eq!(extension_key_parts(refused), None, "member {refused:?}");
        }
    }
}
