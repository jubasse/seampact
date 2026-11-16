// `Number(text)` for a string: ECMAScript StringToNumber.

use crate::is_ecmascript_white_space;

/// The `Infinity` spelling of a decimal text, the only one `Number` reads.
const INFINITY_TEXT: &str = "Infinity";

/// The bits of a significand an `f64` holds, the implicit one included.
const SIGNIFICAND_BITS: usize = 53;

/// The prefixes of a non-decimal integer text and the bits each of its digits carries.
const NON_DECIMAL_PREFIXES: [(&str, u32); 6] = [
    ("0x", 16),
    ("0X", 16),
    ("0o", 8),
    ("0O", 8),
    ("0b", 2),
    ("0B", 2),
];

/// `Number(text)`: the number JavaScript reads from a string, `NaN` when it reads none.
///
/// The text is trimmed of ECMAScript white space and line terminators; an empty text is 0. A
/// `0x`, `0o` or `0b` text (either case, no sign) is an unsigned integer rounded to the nearest
/// `f64`. Any other text is a decimal literal with an optional sign, fraction and exponent, or
/// `Infinity` with an optional sign. `inf`, `nan`, `1_000` and `-0x1` are `NaN`; `-0` is -0.
#[must_use]
pub fn js_number_of_text(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_ecmascript_white_space);

    if trimmed.is_empty() {
        return 0.0;
    }

    for (prefix, radix) in NON_DECIMAL_PREFIXES {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            return non_decimal_integer_of(digits, radix);
        }
    }

    decimal_number_of(trimmed)
}

// A signed decimal literal or `Infinity`.
fn decimal_number_of(text: &str) -> f64 {
    let (negative, unsigned) = if let Some(unsigned) = text.strip_prefix('-') {
        (true, unsigned)
    } else {
        (false, text.strip_prefix('+').unwrap_or(text))
    };

    if unsigned == INFINITY_TEXT {
        return if negative {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }

    if !is_unsigned_decimal_literal(unsigned) {
        return f64::NAN;
    }

    // The grammar is checked above, so Rust reads no `inf` or `nan` spelling; it rounds as
    // JavaScript does, and keeps the sign of a zero.
    text.parse::<f64>().unwrap_or(f64::NAN)
}

// `digits [. digits] [exponent]` or `. digits [exponent]`, the exponent `e` or `E`, an optional
// sign and digits.
fn is_unsigned_decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let integer_digits = ascii_digit_count(bytes, 0);
    let mut position = integer_digits;
    let mut fraction_digits = 0;

    if bytes.get(position) == Some(&b'.') {
        fraction_digits = ascii_digit_count(bytes, position + 1);
        position += 1 + fraction_digits;
    }

    if integer_digits == 0 && fraction_digits == 0 {
        return false;
    }

    if matches!(bytes.get(position), Some(b'e' | b'E')) {
        position += 1;

        if matches!(bytes.get(position), Some(b'+' | b'-')) {
            position += 1;
        }

        let exponent_digits = ascii_digit_count(bytes, position);

        if exponent_digits == 0 {
            return false;
        }

        position += exponent_digits;
    }

    position == bytes.len()
}

// The ASCII digits from `start` on.
fn ascii_digit_count(bytes: &[u8], start: usize) -> usize {
    bytes
        .iter()
        .skip(start)
        .take_while(|byte| byte.is_ascii_digit())
        .count()
}

// The unsigned integer `digits` in a power-of-two radix, rounded to the nearest `f64`, ties to
// even; `NaN` when a digit is missing or outside the radix.
fn non_decimal_integer_of(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }

    let bits_per_digit = radix.trailing_zeros();
    let mut bits: Vec<bool> = Vec::with_capacity(digits.len() * 4);

    for character in digits.chars() {
        let Some(value) = character.to_digit(radix) else {
            return f64::NAN;
        };

        for bit in (0..bits_per_digit).rev() {
            bits.push(value >> bit & 1 == 1);
        }
    }

    let significant: Vec<bool> = bits.into_iter().skip_while(|bit| !bit).collect();

    rounded_binary_integer(&significant)
}

// The integer whose binary digits are `bits`, most significant first and starting with a one,
// rounded to the nearest `f64`, ties to even.
fn rounded_binary_integer(bits: &[bool]) -> f64 {
    let (kept, dropped) = bits.split_at(bits.len().min(SIGNIFICAND_BITS));
    let mut significand = kept
        .iter()
        .fold(0_u64, |value, bit| value << 1 | u64::from(*bit));
    let round_bit = dropped.first().copied().unwrap_or(false);
    let sticky = dropped.iter().skip(1).any(|bit| *bit);

    if round_bit && (sticky || significand & 1 == 1) {
        significand += 1;
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "the significand holds at most 54 bits after rounding, 2^53 at most, exact in an f64"
    )]
    let significand = significand as f64;
    let shift = i32::try_from(dropped.len()).unwrap_or(i32::MAX);

    // A shift past the exponent range overflows to Infinity, as JavaScript reads a huge literal.
    significand * 2_f64.powi(shift)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_number(text: &str, want: f64) {
        let got = js_number_of_text(text);

        assert!(
            got.to_bits() == want.to_bits(),
            "Number({text:?}) is {got:?}, want {want:?}"
        );
    }

    fn assert_nan(text: &str) {
        assert!(js_number_of_text(text).is_nan(), "Number({text:?}) is NaN");
    }

    #[test]
    fn an_empty_or_white_space_text_is_zero() {
        assert_number("", 0.0);
        assert_number("   ", 0.0);
        assert_number("\u{FEFF}\u{A0}\n\u{2028}", 0.0);
    }

    #[test]
    fn white_space_and_line_terminators_are_trimmed() {
        assert_number(" \t12\n", 12.0);
        assert_number("\u{3000}1.5\u{FEFF}", 1.5);
        assert_nan("1 2");
        assert_nan("\u{85}1");
    }

    #[test]
    fn decimal_literals_read_with_sign_fraction_and_exponent() {
        assert_number("1", 1.0);
        assert_number("01", 1.0);
        assert_number("+1.5", 1.5);
        assert_number("-2.5e2", -250.0);
        assert_number("1.", 1.0);
        assert_number(".5", 0.5);
        assert_number("+.5e-1", 0.05);
        assert_number("1E+2", 100.0);
        assert_number("1e-17", 1e-17);
    }

    #[test]
    fn a_malformed_decimal_text_is_nan() {
        for text in [
            ".", "+", "-", "e5", "1e", "1e+", "1.2.3", "--1", "+-1", "1_000", "1,5", "0.5f", "abc",
        ] {
            assert_nan(text);
        }
    }

    #[test]
    fn signed_zero_keeps_its_sign() {
        assert_number("-0", -0.0);
        assert_number("-0.0e5", -0.0);
        assert_number("+0", 0.0);
        assert_number("0", 0.0);
    }

    #[test]
    fn only_the_exact_infinity_spelling_is_infinite() {
        assert_number("Infinity", f64::INFINITY);
        assert_number("+Infinity", f64::INFINITY);
        assert_number("-Infinity", f64::NEG_INFINITY);
        assert_number(" Infinity ", f64::INFINITY);

        for text in [
            "inf", "-inf", "infinity", "INFINITY", "Infinit", "nan", "NaN",
        ] {
            assert_nan(text);
        }
    }

    #[test]
    fn a_decimal_past_the_range_overflows_or_underflows() {
        assert_number("1e400", f64::INFINITY);
        assert_number("-1e400", f64::NEG_INFINITY);
        assert_number("1e-400", 0.0);
        assert_number("-1e-400", -0.0);
    }

    #[test]
    fn the_largest_safe_integer_and_its_neighbours_round_as_doubles() {
        assert_number("9007199254740991", 9_007_199_254_740_991.0);
        assert_number("9007199254740993", 9_007_199_254_740_992.0);
        assert_number("9007199254740995", 9_007_199_254_740_996.0);
    }

    #[test]
    fn non_decimal_prefixes_read_unsigned_integers() {
        assert_number("0x1F", 31.0);
        assert_number("0XfF", 255.0);
        assert_number("0o17", 15.0);
        assert_number("0O7", 7.0);
        assert_number("0b101", 5.0);
        assert_number("0B0", 0.0);
        assert_number(" 0x10 ", 16.0);
    }

    #[test]
    fn a_malformed_non_decimal_text_is_nan() {
        for text in [
            "0x", "0b", "0o", "0x1g", "0b2", "0o8", "-0x1", "+0x1", "0x1.5", "0x1e1p",
        ] {
            assert_nan(text);
        }
    }

    #[test]
    fn a_long_non_decimal_integer_rounds_to_nearest_ties_to_even() {
        // 2^53 + 1 is a tie and rounds down to even; 2^53 + 3 rounds up to 2^53 + 4.
        assert_number("0x20000000000001", 9_007_199_254_740_992.0);
        assert_number("0x20000000000003", 9_007_199_254_740_996.0);
        // Past 2^56 a double steps by 16: 2^56 + 8 is a tie down to even, 2^56 + 24 a tie up to
        // even, and 2^56 + 9 is past the tie.
        assert_number("0x100000000000008", 72_057_594_037_927_936.0);
        assert_number("0x100000000000018", 72_057_594_037_927_968.0);
        assert_number("0x100000000000009", 72_057_594_037_927_952.0);
        assert_number("0x0000000000000000000000000001", 1.0);
        assert_number(&format!("0x1{}", "0".repeat(256)), f64::INFINITY);
        assert_number(&format!("0x1{}", "0".repeat(255)), 2_f64.powi(1020));
    }
}
