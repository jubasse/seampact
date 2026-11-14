// How messages show authored text: the quote of `validate/diagnostics.ts`, the cut of
// `access/rights/report.ts`, and the character classes the printer needs as ECMAScript defines
// them (checked over every code point against `regress`, the ECMAScript engine, in the tests).

use seampact_json::{JsonValue, stringify_json};

/// Past this many code points, [`quote`] cuts the authored value and appends an ellipsis.
const QUOTE_LIMIT: usize = 80;

/// What [`quote`] appends to a value it cut.
const QUOTE_CUT_MARK: char = '\u{2026}';

/// Past this many UTF-16 code units, [`access_rights_quoted`] cuts the text.
const ACCESS_RIGHTS_QUOTED_LIMIT: usize = 80;

/// What [`access_rights_quoted`] ends a cut text with.
const ACCESS_RIGHTS_CUT_MARK: &str = "...";

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

/// An authored value as a message shows it: a string between single quotes, any other value as
/// `JSON.stringify` writes it; past 80 code points cut with an ellipsis; the control, bidi and
/// line-separator characters written as `\uXXXX`.
#[must_use]
pub fn quote(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => quote_text(text),
        other => quote_shown(&stringify_json(other)),
    }
}

/// [`quote`] of a string value: the text between single quotes.
#[must_use]
pub fn quote_text(text: &str) -> String {
    format!("'{}'", quote_shown(text))
}

fn quote_shown(text: &str) -> String {
    let mut shown = String::with_capacity(text.len());

    for character in text.chars().take(QUOTE_LIMIT) {
        if is_unsafe_in_quote(character) {
            write_upper_unicode_escape(&mut shown, character);
        } else {
            shown.push(character);
        }
    }

    if text.chars().nth(QUOTE_LIMIT).is_some() {
        shown.push(QUOTE_CUT_MARK);
    }

    shown
}

#[expect(
    clippy::format_push_string,
    reason = "a rare path; `fmt::Write` on a `String` would leave an infallible `Result` to discard"
)]
fn write_upper_unicode_escape(output: &mut String, character: char) {
    output.push_str(&format!("\\u{:04X}", u32::from(character)));
}

/// The characters [`quote`] escapes: C0, DEL and C1 controls, the bidi controls (ALM, LRM, RLM,
/// LRE to RLO, LRI to PDI) and the line and paragraph separators.
fn is_unsafe_in_quote(character: char) -> bool {
    matches!(
        character,
        '\u{0}'..='\u{1F}'
            | '\u{7F}'..='\u{9F}'
            | '\u{61C}'
            | '\u{200E}'
            | '\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2066}'..='\u{2069}'
            | '\u{2028}'
            | '\u{2029}'
    )
}

/// An author's text as an `access.rights` message quotes it: as is up to 80 UTF-16 code units,
/// else its first 77 units and `...`.
///
/// The TypeScript cut can split a surrogate pair and keep a lone high surrogate, which a Rust
/// string cannot hold; it is written as U+FFFD, the character Node prints for it.
#[must_use]
pub fn access_rights_quoted(text: &str) -> String {
    if text.encode_utf16().count() <= ACCESS_RIGHTS_QUOTED_LIMIT {
        return text.to_owned();
    }

    let kept_units = ACCESS_RIGHTS_QUOTED_LIMIT - ACCESS_RIGHTS_CUT_MARK.len();
    let mut cut = String::with_capacity(text.len());
    let mut units = 0;

    for character in text.chars() {
        let character_units = character.len_utf16();

        if units + character_units > kept_units {
            if units < kept_units {
                cut.push(char::REPLACEMENT_CHARACTER);
            }

            break;
        }

        cut.push(character);
        units += character_units;
    }

    cut.push_str(ACCESS_RIGHTS_CUT_MARK);

    cut
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

    #[test]
    fn a_string_is_quoted_and_another_value_is_its_stringify_text() {
        let object: JsonValue = serde_json::from_str(r#"{"b": 1, "a": [true, null]}"#).unwrap();

        assert_eq!(quote_text("name"), "'name'");
        assert_eq!(quote(&JsonValue::String("été".to_owned())), "'été'");
        assert_eq!(quote(&object), r#"{"b":1,"a":[true,null]}"#);
        assert_eq!(quote(&JsonValue::Null), "null");
    }

    #[test]
    fn control_bidi_and_separator_characters_are_escaped_in_upper_case() {
        assert_eq!(quote_text("a\u{202E}b"), r"'a\u202Eb'");
        assert_eq!(
            quote_text("\u{0}\u{1F}\u{7F}\u{9F}"),
            r"'\u0000\u001F\u007F\u009F'"
        );
        assert_eq!(
            quote_text("\u{2028}\u{2029}\u{61C}"),
            r"'\u2028\u2029\u061C'"
        );
        assert_eq!(quote_text("\u{200B}\u{FEFF}"), "'\u{200B}\u{FEFF}'");
    }

    #[test]
    fn a_quote_past_80_code_points_is_cut_with_an_ellipsis_counting_astral_characters_once() {
        let eighty_astral = "😀".repeat(80);
        let eighty_one_astral = "😀".repeat(81);

        assert_eq!(quote_text(&eighty_astral), format!("'{eighty_astral}'"));
        assert_eq!(
            quote_text(&eighty_one_astral),
            format!("'{eighty_astral}…'")
        );
    }

    #[test]
    fn an_access_rights_quote_counts_utf16_units_and_cuts_to_77_and_three_dots() {
        let eighty = "a".repeat(80);
        let eighty_one = "a".repeat(81);

        assert_eq!(access_rights_quoted(&eighty), eighty);
        assert_eq!(
            access_rights_quoted(&eighty_one),
            format!("{}...", "a".repeat(77))
        );
        assert_eq!(access_rights_quoted(&"😀".repeat(40)), "😀".repeat(40));
        assert_eq!(
            access_rights_quoted(&"😀".repeat(41)),
            format!("{}\u{FFFD}...", "😀".repeat(38))
        );
        assert_eq!(
            access_rights_quoted(&format!("a{}", "😀".repeat(40))),
            format!("a{}...", "😀".repeat(38))
        );
    }
}
