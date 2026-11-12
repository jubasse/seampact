//! The text JavaScript gives a number: `Number.prototype.toString`, `String(n)` and `JSON.stringify(n)`.

use std::fmt;
use std::hash::{Hash, Hasher};

/// A finite `f64`, the only kind of number JSON can hold.
///
/// NaN and the infinities have no JSON text, so they cannot be built: [`FiniteNumber::new`]
/// refuses them, and the number-text helper never meets one.
///
/// Equality is JavaScript `===` on numbers: `0` equals `-0`. `Hash` agrees with it by hashing
/// `-0` as `0`.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct FiniteNumber(f64);

impl FiniteNumber {
    /// The number, or `None` when it is NaN or infinite.
    #[must_use]
    pub fn new(value: f64) -> Option<Self> {
        value.is_finite().then_some(Self(value))
    }

    /// The `f64` JavaScript holds.
    #[must_use]
    pub fn get(self) -> f64 {
        self.0
    }

    /// Whether `Number.isInteger` holds: the number has no fractional part.
    #[must_use]
    pub fn is_integer(self) -> bool {
        self.0.fract() == 0.0
    }
}

// Sound: a finite `f64` is never NaN, the only value not equal to itself.
impl Eq for FiniteNumber {}

impl Hash for FiniteNumber {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // `0.0 == -0.0`, so both hash as `0.0`.
        let normalised_value = if self.0 == 0.0 { 0.0_f64 } else { self.0 };

        normalised_value.to_bits().hash(state);
    }
}

/// The ECMAScript number text: shortest round-trip digits, `1e+21` from 10^21 up,
/// `1e-7` below 10^-6, and `-0` written `0`.
impl fmt::Display for FiniteNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buffer = ryu_js::Buffer::new();

        formatter.write_str(buffer.format_finite(self.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::hash::DefaultHasher;

    /// 2^53, the first integer past which an `f64` skips integers.
    const TWO_POW_53: f64 = 9_007_199_254_740_992.0;

    fn number_text(value: f64) -> String {
        FiniteNumber::new(value).map(|number| number.to_string()).unwrap()
    }

    fn hash_of(number: FiniteNumber) -> u64 {
        let mut hasher = DefaultHasher::new();

        number.hash(&mut hasher);

        hasher.finish()
    }

    #[test]
    fn zero_and_negative_zero_are_written_zero() {
        assert_eq!(number_text(0.0), "0");
        assert_eq!(number_text(-0.0), "0");
    }

    #[test]
    fn fractions_are_written_with_the_shortest_round_trip_digits() {
        assert_eq!(number_text(0.1), "0.1");
        assert_eq!(number_text(1.5), "1.5");
        assert_eq!(number_text(-1.5), "-1.5");
    }

    #[test]
    fn exponent_form_starts_at_1e21_and_below_1e_minus_6() {
        assert_eq!(number_text(1e21), "1e+21");
        assert_eq!(number_text(1e20), "100000000000000000000");
        assert_eq!(number_text(1e-7), "1e-7");
        assert_eq!(number_text(1e-6), "0.000001");
        assert_eq!(number_text(123e-20), "1.23e-18");
    }

    #[test]
    fn extreme_values_keep_their_digits() {
        assert_eq!(number_text(5e-324), "5e-324");
        assert_eq!(number_text(f64::MAX), "1.7976931348623157e+308");
    }

    #[test]
    fn integers_around_2_pow_53_are_written_whole() {
        assert_eq!(number_text(TWO_POW_53), "9007199254740992");
        assert_eq!(number_text(TWO_POW_53 + 2.0), "9007199254740994");
    }

    #[test]
    fn nan_and_infinities_cannot_be_built() {
        assert_eq!(FiniteNumber::new(f64::NAN), None);
        assert_eq!(FiniteNumber::new(f64::INFINITY), None);
        assert_eq!(FiniteNumber::new(f64::NEG_INFINITY), None);
    }

    #[test]
    fn negative_zero_equals_zero_and_hashes_alike() {
        let zero = FiniteNumber::new(0.0).unwrap();
        let negative_zero = FiniteNumber::new(-0.0).unwrap();

        assert_eq!(zero, negative_zero);
        assert_eq!(hash_of(zero), hash_of(negative_zero));
    }

    #[test]
    fn is_integer_follows_number_is_integer() {
        assert!(FiniteNumber::new(404.0).unwrap().is_integer());
        assert!(FiniteNumber::new(-0.0).unwrap().is_integer());
        assert!(!FiniteNumber::new(1e-17).unwrap().is_integer());
        assert!(!FiniteNumber::new(1.5).unwrap().is_integer());
    }
}
