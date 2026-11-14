//! Sentences made of a schema's description or reason.

/// `text` with its first UTF-16 unit lower-cased, as `lowerFirst` writes it.
#[must_use]
pub(crate) fn lower_first(text: &str) -> String {
    map_first_unit(text, |first| first.to_lowercase().collect())
}

/// `text` trimmed, capitalised and ended by a full stop unless it ends by `.`, `!` or `?`.
#[must_use]
pub(crate) fn sentence(text: &str) -> String {
    let trimmed = text.trim_matches(seampact_js::is_ecmascript_white_space);
    let capital = map_first_unit(trimmed, |first| first.to_uppercase().collect());

    if capital.ends_with(['.', '!', '?']) {
        capital
    } else {
        format!("{capital}.")
    }
}

// Maps the first UTF-16 unit; an astral character starts with a surrogate, which keeps its case.
fn map_first_unit(text: &str, map: impl FnOnce(char) -> String) -> String {
    let mut characters = text.chars();
    let Some(first) = characters.next() else {
        return String::new();
    };

    if u32::from(first) > u32::from(u16::MAX) {
        return text.to_owned();
    }

    format!("{}{}", map(first), characters.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_unit_changes_case_and_an_astral_character_keeps_it() {
        assert_eq!(lower_first("Hello World"), "hello World");
        assert_eq!(lower_first(""), "");
        assert_eq!(lower_first("\u{1D400}x"), "\u{1D400}x");
        assert_eq!(sentence("\u{1D41A}b"), "\u{1D41A}b.");
        // The upper case of a sharp s is two letters.
        assert_eq!(sentence("\u{DF}x"), "SSx.");
    }

    #[test]
    fn a_sentence_is_trimmed_and_ended_once() {
        assert_eq!(sentence("  write it  "), "Write it.");
        assert_eq!(sentence("done!"), "Done!");
        assert_eq!(sentence("really?"), "Really?");
        assert_eq!(sentence("\u{FEFF}\u{2028}ok.\u{A0}"), "Ok.");
        assert_eq!(sentence(""), ".");
    }
}
