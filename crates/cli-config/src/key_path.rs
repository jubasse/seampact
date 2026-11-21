//! A path of keys and list positions into a config value, and its text.

use seampact_js::FiniteNumber;

/// One step of a key path: a mapping key, or a list position as JavaScript's `Number` reads it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum KeyPathSegment {
    /// A mapping key.
    Key(String),
    /// A list position, or a digit-only key such as a status code.
    Index(FiniteNumber),
}

/// A path from the root of a config to one of its values.
pub(crate) type KeyPath = Vec<KeyPathSegment>;

impl KeyPathSegment {
    /// The segment of a key written as text.
    pub(crate) fn key(text: &str) -> Self {
        Self::Key(text.to_owned())
    }

    /// The segment of a list position.
    pub(crate) fn position(index: usize) -> Self {
        let whole = i64::try_from(index).unwrap_or(i64::MAX);

        Self::Index(FiniteNumber::from_i64(whole))
    }
}

/// `targets[0].artefacts.bootCheck`: list positions in brackets, keys joined by dots.
pub(crate) fn format_key_path(path: &[KeyPathSegment]) -> String {
    path.iter()
        .enumerate()
        .map(|(position, segment)| match segment {
            KeyPathSegment::Index(number) => format!("[{number}]"),
            KeyPathSegment::Key(key) if position == 0 => key.clone(),
            KeyPathSegment::Key(key) => format!(".{key}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_digit_key_beyond_integer_precision_prints_as_a_javascript_number() {
        let huge = FiniteNumber::new(12_345_678_901_234_567_890_f64);
        let path = vec![
            KeyPathSegment::key("openapi"),
            KeyPathSegment::Index(huge.unwrap_or_else(|| FiniteNumber::from_i64(0))),
            KeyPathSegment::key("path"),
        ];

        assert_eq!(format_key_path(&path), "openapi[12345678901234567000].path");
    }

    #[test]
    fn the_first_key_has_no_dot_and_a_list_position_has_brackets() {
        let path = vec![
            KeyPathSegment::key("targets"),
            KeyPathSegment::position(2),
            KeyPathSegment::key("id"),
        ];

        assert_eq!(format_key_path(&path), "targets[2].id");
    }
}
