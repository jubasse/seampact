const SHOWN_KEY_LIMIT: usize = 8;

/// The tail of a fix that asks for a mapping: the keys it may hold, the first eight then
/// `...`; empty when none is known.
#[must_use]
pub fn mapping_keys_hint<Key: AsRef<str>>(keys: &[Key]) -> String {
    if keys.is_empty() {
        return String::new();
    }

    let shown = keys
        .iter()
        .take(SHOWN_KEY_LIMIT)
        .map(AsRef::as_ref)
        .collect::<Vec<&str>>()
        .join(", ");
    let more = if keys.len() > SHOWN_KEY_LIMIT {
        ", ..."
    } else {
        ""
    };

    format!(" with the keys {shown}{more}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_key_gives_no_hint() {
        assert_eq!(mapping_keys_hint::<&str>(&[]), "");
    }

    #[test]
    fn up_to_eight_keys_are_all_shown() {
        let keys = ["a", "b", "c", "d", "e", "f", "g", "h"];

        assert_eq!(
            mapping_keys_hint(&keys),
            " with the keys a, b, c, d, e, f, g, h"
        );
        assert_eq!(mapping_keys_hint(&["only"]), " with the keys only");
    }

    #[test]
    fn a_ninth_key_becomes_an_ellipsis() {
        let keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

        assert_eq!(
            mapping_keys_hint(&keys),
            " with the keys a, b, c, d, e, f, g, h, ..."
        );
    }
}
