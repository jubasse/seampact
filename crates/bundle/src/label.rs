//! The rule of a manifest name or version.

/// The longest label, in UTF-16 code units (the schema's `$defs/label` `maxLength`).
const LABEL_MAX_LENGTH: usize = 214;

/// Why `label` is not a manifest name or version, or `None` when it is one.
#[must_use]
pub fn bundle_label_problem(label: &str) -> Option<String> {
    if label.encode_utf16().count() > LABEL_MAX_LENGTH {
        return Some(format!("is longer than {LABEL_MAX_LENGTH} characters"));
    }

    let printable = !label.is_empty()
        && label
            .chars()
            .all(|character| ('!'..='~').contains(&character));

    if !printable {
        return Some(
            "is empty or holds a character outside printable ASCII (a space, a control or a non-ASCII character)"
                .to_owned(),
        );
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_length_is_counted_in_utf16_units() {
        assert_eq!(bundle_label_problem(&"a".repeat(214)), None);
        assert!(bundle_label_problem(&"a".repeat(215)).is_some_and(|p| p.starts_with("is longer")));
        assert!(
            bundle_label_problem(&"\u{1F600}".repeat(108))
                .is_some_and(|p| p.starts_with("is longer")),
            "108 astral characters are 216 units"
        );
    }

    #[test]
    fn empty_space_control_and_non_ascii_are_refused() {
        for label in ["", "a b", "a\u{7f}", "\u{e9}", "a\n"] {
            assert!(
                bundle_label_problem(label).is_some_and(|p| p.starts_with("is empty or holds")),
                "label {label:?}"
            );
        }
    }
}
