// ECMAScript white space, checked over every code point against `regress`, the
// ECMAScript engine, in the tests below.

/// ECMAScript `WhiteSpace` and `LineTerminator`: what `\s` matches and `trim` removes.
const WHITE_SPACE_RANGES: &[(char, char)] = &[
    ('\u{9}', '\u{D}'),
    ('\u{20}', '\u{20}'),
    ('\u{A0}', '\u{A0}'),
    ('\u{1680}', '\u{1680}'),
    ('\u{2000}', '\u{200A}'),
    ('\u{2028}', '\u{2029}'),
    ('\u{202F}', '\u{202F}'),
    ('\u{205F}', '\u{205F}'),
    ('\u{3000}', '\u{3000}'),
    ('\u{FEFF}', '\u{FEFF}'),
];

/// Whether `character` matches the ECMAScript `\s`.
///
/// Unlike [`char::is_whitespace`], this includes U+FEFF and leaves out U+0085.
#[must_use]
pub fn is_ecmascript_white_space(character: char) -> bool {
    WHITE_SPACE_RANGES
        .iter()
        .any(|&(first, last)| first <= character && character <= last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_ecmascript_s() {
        let regex = regress::Regex::with_flags(r"^\s$", "u").unwrap();
        let mut buffer = [0_u8; 4];

        for character in (0..=u32::from(char::MAX)).filter_map(char::from_u32) {
            let text = character.encode_utf8(&mut buffer);

            assert_eq!(
                is_ecmascript_white_space(character),
                regex.find(text).is_some(),
                "U+{:04X}",
                u32::from(character)
            );
        }
    }

    #[test]
    fn it_differs_from_rust_on_the_byte_order_mark_and_next_line() {
        assert!(is_ecmascript_white_space('\u{FEFF}'));
        assert!(!is_ecmascript_white_space('\u{85}'));
    }
}
