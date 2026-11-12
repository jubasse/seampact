// Character classes the printer needs, as ECMAScript defines them. The table is checked
// over every code point against `regress`, the ECMAScript engine, in the tests below.

/// Cc, Cf, Zl and Zp: the characters a terminal acts on, or that hide or reorder text.
const ACTIVE_RANGES: &[(char, char)] = &[
    ('\u{0}', '\u{1F}'),
    ('\u{7F}', '\u{9F}'),
    ('\u{AD}', '\u{AD}'),
    ('\u{600}', '\u{605}'),
    ('\u{61C}', '\u{61C}'),
    ('\u{6DD}', '\u{6DD}'),
    ('\u{70F}', '\u{70F}'),
    ('\u{890}', '\u{891}'),
    ('\u{8E2}', '\u{8E2}'),
    ('\u{180E}', '\u{180E}'),
    ('\u{200B}', '\u{200F}'),
    ('\u{2028}', '\u{202E}'),
    ('\u{2060}', '\u{2064}'),
    ('\u{2066}', '\u{206F}'),
    ('\u{FEFF}', '\u{FEFF}'),
    ('\u{FFF9}', '\u{FFFB}'),
    ('\u{110BD}', '\u{110BD}'),
    ('\u{110CD}', '\u{110CD}'),
    ('\u{13430}', '\u{1343F}'),
    ('\u{1BCA0}', '\u{1BCA3}'),
    ('\u{1D173}', '\u{1D17A}'),
    ('\u{E0001}', '\u{E0001}'),
    ('\u{E0020}', '\u{E007F}'),
];

fn in_ranges(character: char, ranges: &[(char, char)]) -> bool {
    ranges
        .iter()
        .any(|&(first, last)| first <= character && character <= last)
}

/// Whether `character` is Cc, Cf, Zl or Zp.
pub(crate) fn is_active_character(character: char) -> bool {
    in_ranges(character, ACTIVE_RANGES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_scalar_value() -> impl Iterator<Item = char> {
        (0..=u32::from(char::MAX)).filter_map(char::from_u32)
    }

    fn assert_table_matches(pattern: &str, in_table: fn(char) -> bool) {
        let regex = regress::Regex::with_flags(pattern, "u").unwrap();
        let mut buffer = [0_u8; 4];

        for character in every_scalar_value() {
            let text = character.encode_utf8(&mut buffer);

            assert_eq!(
                in_table(character),
                regex.find(text).is_some(),
                "U+{:04X} against {pattern}",
                u32::from(character)
            );
        }
    }

    #[test]
    fn the_active_table_is_cc_cf_zl_and_zp() {
        assert_table_matches(r"^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$", is_active_character);
    }
}
