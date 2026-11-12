//! A JSON number as JavaScript holds it, with the exact digits of an integer above 2^53.

use std::fmt;
use std::hash::{Hash, Hasher};
use std::ops::RangeInclusive;

use seampact_js::FiniteNumber;

/// 2^53: every integer up to it is exact in an `f64`, and the text of each is the same.
const TWO_POW_53_DIGITS: &str = "9007199254740992";

/// A finite JSON number.
///
/// An integer written above 2^53 in magnitude keeps its digits, as ADR 0031 asks of examples
/// and defaults; every other number is the `f64` `JSON.parse` would give.
///
/// Equality is JavaScript `===` on [`JsonNumber::to_f64`]: `0` equals `-0`, and 2^53 + 1 equals
/// 2^53, as they did in 1.x. `Hash` agrees with it. Only the written text tells them apart.
#[derive(Debug, Clone)]
pub struct JsonNumber(Repr);

#[derive(Debug, Clone)]
enum Repr {
    Finite(FiniteNumber),
    ExactInteger {
        digits: Box<str>,
        rounded: FiniteNumber,
    },
}

impl JsonNumber {
    /// The number, or `None` when it is NaN or infinite.
    #[must_use]
    pub fn from_f64(value: f64) -> Option<Self> {
        FiniteNumber::new(value).map(|number| Self(Repr::Finite(number)))
    }

    /// The number a JSON number text denotes, or `None` when the text is no JSON number or
    /// denotes no finite `f64` (`1e400`).
    ///
    /// Integer text above 2^53 in magnitude keeps its digits; exponent and fraction forms are
    /// always an `f64`, as in JavaScript.
    #[must_use]
    pub fn from_json_text(text: &str) -> Option<Self> {
        let form = json_number_form(text)?;
        let rounded = FiniteNumber::new(text.parse::<f64>().ok()?)?;

        if form == NumberForm::Integer && is_above_two_pow_53(text) {
            let digits = Box::from(text);

            return Some(Self(Repr::ExactInteger { digits, rounded }));
        }

        Some(Self(Repr::Finite(rounded)))
    }

    /// The `f64` JavaScript holds: the rounded value of an exact integer.
    #[must_use]
    pub fn to_f64(&self) -> f64 {
        self.finite_value().get()
    }

    /// Whether `Number.isInteger` holds: `404.0` and `4.04e2` are integers, `1e-17` is not.
    #[must_use]
    pub fn is_integer(&self) -> bool {
        self.finite_value().is_integer()
    }

    /// The `i64` of the number when it is an integer whose `f64` lies in `allowed`, else `None`.
    ///
    /// The bounds of `allowed` must be within 2^53 in magnitude, where every `i64` is an exact
    /// `f64`; the comparison is made on the `f64`, as JavaScript makes it.
    pub(crate) fn integer_within(&self, allowed: &RangeInclusive<i64>) -> Option<i64> {
        let value = self.to_f64();

        #[expect(
            clippy::cast_precision_loss,
            reason = "the bounds are within 2^53 in magnitude, where every i64 is an exact f64"
        )]
        let is_within = (*allowed.start() as f64) <= value && value <= (*allowed.end() as f64);

        if !self.is_integer() || !is_within {
            return None;
        }

        #[expect(
            clippy::cast_possible_truncation,
            reason = "an integer within 2^53 in magnitude, so the cast is exact"
        )]
        let integer = value as i64;

        Some(integer)
    }

    /// The digits of an integer kept exact above 2^53, else `None`.
    #[must_use]
    pub fn exact_digits(&self) -> Option<&str> {
        match &self.0 {
            Repr::Finite(_) => None,
            Repr::ExactInteger { digits, .. } => Some(digits),
        }
    }

    pub(crate) fn finite_value(&self) -> FiniteNumber {
        match &self.0 {
            Repr::Finite(number) => *number,
            Repr::ExactInteger { rounded, .. } => *rounded,
        }
    }
}

impl PartialEq for JsonNumber {
    fn eq(&self, other: &Self) -> bool {
        self.finite_value() == other.finite_value()
    }
}

// Sound: every value is finite, so equality is reflexive.
impl Eq for JsonNumber {}

impl Hash for JsonNumber {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.finite_value().hash(state);
    }
}

/// The ECMAScript number text (`1e+21`, `-0` written `0`), or the exact digits.
impl fmt::Display for JsonNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Repr::Finite(number) => number.fmt(formatter),
            Repr::ExactInteger { digits, .. } => formatter.write_str(digits),
        }
    }
}

/// Whether a JSON number text is an integer, or has a fraction or an exponent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NumberForm {
    Integer,
    FractionOrExponent,
}

/// The form of `text` when it matches the JSON number grammar of RFC 8259, else `None`.
///
/// `str::parse::<f64>` alone would accept `inf`, `NaN`, `+1` and `.5`, which JSON refuses.
fn json_number_form(text: &str) -> Option<NumberForm> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let integer_digits = leading_digit_count(unsigned);
    let has_leading_zero = integer_digits > 1 && unsigned.starts_with('0');

    if integer_digits == 0 || has_leading_zero {
        return None;
    }

    let after_integer = unsigned.get(integer_digits..)?;
    let after_fraction = match after_integer.strip_prefix('.') {
        Some(fraction) => digits_then_rest(fraction)?,
        None => after_integer,
    };
    let after_exponent = match after_fraction.strip_prefix(['e', 'E']) {
        Some(exponent) => digits_then_rest(exponent.strip_prefix(['+', '-']).unwrap_or(exponent))?,
        None => after_fraction,
    };

    if !after_exponent.is_empty() {
        return None;
    }

    if after_integer.is_empty() {
        return Some(NumberForm::Integer);
    }

    Some(NumberForm::FractionOrExponent)
}

/// The text after one or more leading ASCII digits, or `None` when `text` starts with none.
fn digits_then_rest(text: &str) -> Option<&str> {
    let digit_count = leading_digit_count(text);

    if digit_count == 0 {
        return None;
    }

    text.get(digit_count..)
}

fn leading_digit_count(text: &str) -> usize {
    text.bytes().take_while(u8::is_ascii_digit).count()
}

/// Whether canonical integer text (an optional `-`, no leading zero) is above 2^53 in magnitude.
fn is_above_two_pow_53(integer_text: &str) -> bool {
    let magnitude = integer_text.strip_prefix('-').unwrap_or(integer_text);

    // Canonical digits of equal length compare as their values.
    (magnitude.len(), magnitude) > (TWO_POW_53_DIGITS.len(), TWO_POW_53_DIGITS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(text: &str) -> JsonNumber {
        JsonNumber::from_json_text(text).unwrap()
    }

    #[test]
    fn integers_above_2_pow_53_keep_their_digits() {
        assert_eq!(
            number("9007199254740993").exact_digits(),
            Some("9007199254740993")
        );
        assert_eq!(number("-9007199254740993").to_string(), "-9007199254740993");
        assert_eq!(
            number("100000000000000000000000000001").to_string(),
            "100000000000000000000000000001"
        );
    }

    #[test]
    fn integers_up_to_2_pow_53_are_f64() {
        assert_eq!(number("9007199254740992").exact_digits(), None);
        assert_eq!(number("-9007199254740992").exact_digits(), None);
        assert_eq!(number("9007199254740992").to_string(), "9007199254740992");
    }

    #[test]
    fn exact_integers_compare_as_their_rounded_value() {
        assert_eq!(number("9007199254740993"), number("9007199254740992"));
        assert!(
            (number("9007199254740993").to_f64() - 9_007_199_254_740_992.0).abs() < f64::EPSILON
        );
    }

    #[test]
    fn exact_integers_hash_as_their_rounded_value() {
        use std::hash::{DefaultHasher, Hash, Hasher};

        let hash_of = |number: JsonNumber| {
            let mut hasher = DefaultHasher::new();

            number.hash(&mut hasher);

            hasher.finish()
        };

        assert_eq!(
            hash_of(number("9007199254740993")),
            hash_of(number("9007199254740992"))
        );
    }

    #[test]
    fn exponent_and_fraction_forms_are_f64() {
        assert_eq!(number("1e21").exact_digits(), None);
        assert_eq!(number("1e21").to_string(), "1e+21");
        assert_eq!(number("10000000000000000000000.0").to_string(), "1e+22");
        assert_eq!(number("4.04e2").to_string(), "404");
    }

    #[test]
    fn negative_zero_is_written_zero_and_equals_zero() {
        assert_eq!(number("-0").to_string(), "0");
        assert_eq!(number("-0"), number("0"));
        assert_eq!(number("-0.0"), number("0"));
    }

    #[test]
    fn tiny_fractions_stay_fractions() {
        assert_eq!(number("1e-17").to_string(), "1e-17");
        assert_eq!(number("0.1").to_string(), "0.1");
    }

    #[test]
    fn text_outside_the_json_grammar_is_refused() {
        for text in [
            "", "-", "inf", "NaN", "Infinity", "+1", ".5", "1.", "01", "1e", "1e+", "0x10", " 1",
        ] {
            assert!(
                JsonNumber::from_json_text(text).is_none(),
                "accepted {text:?}"
            );
        }
    }

    #[test]
    fn numbers_beyond_f64_are_refused() {
        assert!(JsonNumber::from_json_text("1e400").is_none());
        assert!(JsonNumber::from_json_text("-1e400").is_none());
    }

    #[test]
    fn nan_and_infinities_are_refused() {
        assert!(JsonNumber::from_f64(f64::NAN).is_none());
        assert!(JsonNumber::from_f64(f64::INFINITY).is_none());
    }
}
