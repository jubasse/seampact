// `Number(text)` read as a list index, as `list[Number(text)]` does.

use crate::is_ecmascript_white_space;

/// The largest integer an `f64` holds exactly, 2^53 - 1.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The index `list[Number(text)]` reads in a list of `length` elements, if `Number(text)` is one.
///
/// `Number` reads the text after trimming ECMAScript white space: an empty text is 0, a `0x`,
/// `0o` or `0b` text is an unsigned integer, and any other text is a decimal literal with an
/// optional sign, fraction and exponent. `-0` is the index 0; `1.5`, `abc` and `Infinity` are no index.
#[must_use]
pub fn list_index_of_number_text(text: &str, length: usize) -> Option<usize> {
    let number = js_number_of_text(text.trim_matches(is_ecmascript_white_space))?;

    if number.fract() != 0.0 || !(0.0..=MAX_SAFE_INTEGER).contains(&number) {
        return None;
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the number is a non-negative integer of at most 2^53, checked above"
    )]
    let position = number as u64;
    let position = usize::try_from(position).ok()?;

    (position < length).then_some(position)
}

fn js_number_of_text(text: &str) -> Option<f64> {
    if text.is_empty() {
        return Some(0.0);
    }

    for (prefixes, radix) in [(["0x", "0X"], 16), (["0o", "0O"], 8), (["0b", "0B"], 2)] {
        let digits = prefixes.iter().find_map(|prefix| text.strip_prefix(prefix));

        if let Some(digits) = digits {
            return unsigned_integer_of(digits, radix);
        }
    }

    let is_decimal_text = text.chars().all(|character| {
        character.is_ascii_digit() || matches!(character, '.' | 'e' | 'E' | '+' | '-')
    });

    if !is_decimal_text {
        return None;
    }

    text.parse::<f64>().ok()
}

fn unsigned_integer_of(digits: &str, radix: u32) -> Option<f64> {
    if digits.is_empty() || !digits.chars().all(|character| character.is_digit(radix)) {
        return None;
    }

    // A value past u64 is no list index: answer a number that no index check accepts.
    let value = u64::from_str_radix(digits, radix).ok()?;

    #[expect(
        clippy::cast_precision_loss,
        reason = "a value past 2^53 is refused by the index check whatever its low bits"
    )]
    Some(value as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LENGTH: usize = 4_294_967_296;

    #[test]
    fn the_text_is_read_as_javascript_number_is() {
        let cases: [(&str, Option<usize>); 12] = [
            ("1", Some(1)),
            ("01", Some(1)),
            ("1.0", Some(1)),
            (" 1", Some(1)),
            ("0x1", Some(1)),
            ("1e0", Some(1)),
            ("", Some(0)),
            ("-0", Some(0)),
            ("1.5", None),
            ("abc", None),
            ("4294967295", Some(4_294_967_295)),
            ("0x", None),
        ];

        for (text, want) in cases {
            assert_eq!(list_index_of_number_text(text, LENGTH), want, "{text:?}");
        }
    }

    #[test]
    fn an_index_past_the_list_is_none() {
        assert_eq!(list_index_of_number_text("2", 2), None);
        assert_eq!(list_index_of_number_text("1", 2), Some(1));
    }
}
