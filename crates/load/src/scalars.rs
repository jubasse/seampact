//! Plain scalars: how the YAML 1.2 core schema reads them, and the pitfalls P1 to P4 of ADR 0002
//! section 3.
//!
//! [`resolve_plain_scalar`] is the resolver of the `yaml` package's core schema, spelling by
//! spelling. The pitfall expressions are the ADR's, verbatim, run by `regress` (the ECMAScript
//! engine) and built once per load in [`PitfallPatterns`].

use regress::Regex;
use seampact_diagnostics::InternalError;
use seampact_js::FiniteNumber;
use seampact_json::{JsonNumber, JsonValue};

const P1: &str = r"^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|True|TRUE|False|FALSE)$";
const P2_PLAIN_DECIMAL: &str = r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$";
const P3_NUMBER: &str = r"^[-+]?(0b[01_]+|0[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?|[0-9][0-9_]*_[0-9_]*|([0-9][0-9_]*)?\.[0-9_]*_[0-9_]*)$";
const P3_TIMESTAMP: &str = r"^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ]|$)";
const P4: &str = r"^(=|<<)$";

const OCTAL_BITS_PER_DIGIT: u32 = 3;
const HEXADECIMAL_BITS_PER_DIGIT: u32 = 4;

/// Mantissa bits kept while a base 8 or 16 token is read: more than the 53 an `f64` holds plus
/// the two bits that decide rounding, with the lowest bit standing for every digit dropped.
const KEPT_MANTISSA_BITS: u32 = 120;

/// A shift past which a base 8 or 16 token is infinite whatever its mantissa.
const MAX_USEFUL_SHIFT: u32 = 2_000;

/// What the core schema made of a plain scalar: the JavaScript value of the `yaml` package.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedScalar {
    /// `null`, `Null`, `NULL`, `~` or nothing.
    Null,
    /// `true`, `True`, `TRUE`, `false`, `False` or `FALSE`.
    Bool(bool),
    /// A decimal, octal, hexadecimal or floating point number with a finite value.
    Number(JsonNumber),
    /// A number with no finite `f64`: `.inf` and `.nan` in any case, or a token that overflows.
    ///
    /// It is a number for P2 and P6, and [`JsonValue::Null`] in a built tree. P2 refuses such a
    /// token with an error, so the load stops before anything reads that tree value.
    NonFinite,
    /// Any other text.
    String(String),
}

impl ResolvedScalar {
    /// Whether JavaScript's `typeof` is `number`.
    #[must_use]
    pub fn is_number(&self) -> bool {
        matches!(self, Self::Number(_) | Self::NonFinite)
    }

    /// The value placed in a built tree.
    #[must_use]
    pub fn into_json_value(self) -> JsonValue {
        match self {
            Self::Null | Self::NonFinite => JsonValue::Null,
            Self::Bool(flag) => JsonValue::Bool(flag),
            Self::Number(number) => JsonValue::Number(number),
            Self::String(text) => JsonValue::String(text),
        }
    }

    /// `String(value)`: the text JavaScript makes of the value.
    #[must_use]
    pub fn to_js_string(&self) -> String {
        match self {
            Self::Null => "null".to_owned(),
            Self::Bool(flag) => flag.to_string(),
            Self::Number(number) => match FiniteNumber::new(number.to_f64()) {
                Some(finite) => finite.to_string(),
                None => "NaN".to_owned(),
            },
            Self::NonFinite => "NaN".to_owned(),
            Self::String(text) => text.clone(),
        }
    }
}

/// Reads a plain scalar as the core schema does.
#[must_use]
pub fn resolve_plain_scalar(source: &str) -> ResolvedScalar {
    if is_null_spelling(source) {
        return ResolvedScalar::Null;
    }

    if let Some(flag) = bool_spelling(source) {
        return ResolvedScalar::Bool(flag);
    }

    match number_spelling(source) {
        Some(number) => number,
        None => ResolvedScalar::String(source.to_owned()),
    }
}

/// `^(?:~|[Nn]ull|NULL)?$`.
fn is_null_spelling(source: &str) -> bool {
    matches!(source, "" | "~" | "null" | "Null" | "NULL")
}

/// `^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$`.
fn bool_spelling(source: &str) -> Option<bool> {
    match source {
        "true" | "True" | "TRUE" => Some(true),
        "false" | "False" | "FALSE" => Some(false),
        _ => None,
    }
}

/// The number a plain scalar spells, tried in the core schema's order: octal, decimal integer,
/// hexadecimal, `.inf` and `.nan`, exponent float, float.
fn number_spelling(source: &str) -> Option<ResolvedScalar> {
    if let Some(digits) = source.strip_prefix("0o")
        && is_digits_of(digits, |byte| matches!(byte, b'0'..=b'7'))
    {
        return Some(finite_or_not(power_of_two_radix_value(
            digits,
            OCTAL_BITS_PER_DIGIT,
        )));
    }

    if is_decimal_integer(source) {
        return Some(decimal_integer_value(source));
    }

    if let Some(digits) = source.strip_prefix("0x")
        && is_digits_of(digits, |byte| byte.is_ascii_hexdigit())
    {
        return Some(finite_or_not(power_of_two_radix_value(
            digits,
            HEXADECIMAL_BITS_PER_DIGIT,
        )));
    }

    if is_infinity_or_nan(source) {
        return Some(ResolvedScalar::NonFinite);
    }

    if is_exponent_float(source) || is_plain_float(source) {
        // Rust reads every spelling the two predicates accept (a table and a property test hold
        // it), so a parse error cannot happen; `None` is read as non-finite only to stay total.
        return Some(finite_or_not(source.parse::<f64>().ok()));
    }

    None
}

fn finite_or_not(value: Option<f64>) -> ResolvedScalar {
    match value.and_then(JsonNumber::from_f64) {
        Some(number) => ResolvedScalar::Number(number),
        None => ResolvedScalar::NonFinite,
    }
}

/// At least one byte, and every byte accepted.
fn is_digits_of(text: &str, accepted: impl Fn(u8) -> bool) -> bool {
    !text.is_empty() && text.bytes().all(accepted)
}

fn without_sign(text: &str) -> &str {
    text.strip_prefix(['-', '+']).unwrap_or(text)
}

/// `^[-+]?[0-9]+$`.
fn is_decimal_integer(source: &str) -> bool {
    is_digits_of(without_sign(source), |byte| byte.is_ascii_digit())
}

/// `parseInt(source, 10)` of a decimal integer: the digits above 2^53 stay exact in the
/// [`JsonNumber`], a sign and leading zeros are not part of the number.
fn decimal_integer_value(source: &str) -> ResolvedScalar {
    let magnitude = without_sign(source).trim_start_matches('0');
    let digits = if magnitude.is_empty() { "0" } else { magnitude };
    let canonical = if source.starts_with('-') {
        format!("-{digits}")
    } else {
        digits.to_owned()
    };

    match JsonNumber::from_json_text(&canonical) {
        Some(number) => ResolvedScalar::Number(number),
        None => ResolvedScalar::NonFinite,
    }
}

/// `^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$`.
fn is_infinity_or_nan(source: &str) -> bool {
    matches!(without_sign(source), ".inf" | ".Inf" | ".INF")
        || matches!(source, ".nan" | ".NaN" | ".NAN")
}

/// The digits of a number written in base 2^`bits_per_digit`, as the `f64` `parseInt` gives:
/// the exact value rounded to nearest, ties to even, or infinity past the `f64` range (`None`).
fn power_of_two_radix_value(digits: &str, bits_per_digit: u32) -> Option<f64> {
    let mut mantissa: u128 = 0;
    let mut mantissa_bits: u32 = 0;
    let mut dropped_bits: u32 = 0;
    let mut dropped_any_set_bit = false;

    for digit in digits.chars().filter_map(|digit| digit.to_digit(16)) {
        if mantissa_bits + bits_per_digit <= KEPT_MANTISSA_BITS {
            mantissa = (mantissa << bits_per_digit) | u128::from(digit);

            if mantissa != 0 {
                mantissa_bits += bits_per_digit;
            }

            continue;
        }

        dropped_any_set_bit |= digit != 0;
        dropped_bits = dropped_bits.saturating_add(bits_per_digit);
    }

    if dropped_any_set_bit {
        mantissa |= 1;
    }

    // `as` rounds a u128 to the nearest f64, ties to even.
    #[expect(
        clippy::cast_precision_loss,
        reason = "the rounding to the nearest f64 is what parseInt does"
    )]
    let rounded = mantissa as f64;
    // 2^2000 is already infinite, so a larger shift changes nothing.
    let scaled = rounded * f64::from(dropped_bits.min(MAX_USEFUL_SHIFT)).exp2();

    scaled.is_finite().then_some(scaled)
}

/// `^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$`.
fn is_exponent_float(source: &str) -> bool {
    let Some(exponent_at) = source.find(['e', 'E']) else {
        return false;
    };
    let (mantissa, exponent) = source.split_at(exponent_at);
    let exponent_digits = without_sign(exponent.get(1..).unwrap_or(""));

    is_digits_of(exponent_digits, |byte| byte.is_ascii_digit())
        && is_float_mantissa(without_sign(mantissa), FractionDigits::Optional)
}

/// `^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$`.
fn is_plain_float(source: &str) -> bool {
    is_float_mantissa(without_sign(source), FractionDigits::RequiredAfterDot)
}

#[derive(Clone, Copy)]
enum FractionDigits {
    /// `[0-9]+` alone, `[0-9]+.[0-9]*` or `.[0-9]+`.
    Optional,
    /// `[0-9]+.[0-9]*` or `.[0-9]+`: a dot is always there.
    RequiredAfterDot,
}

fn is_float_mantissa(text: &str, fraction: FractionDigits) -> bool {
    let Some((whole, fractional)) = text.split_once('.') else {
        return matches!(fraction, FractionDigits::Optional)
            && is_digits_of(text, |byte| byte.is_ascii_digit());
    };
    let whole_is_digits = whole.bytes().all(|byte| byte.is_ascii_digit());
    let fractional_is_digits = fractional.bytes().all(|byte| byte.is_ascii_digit());

    if whole.is_empty() {
        return !fractional.is_empty() && fractional_is_digits;
    }

    whole_is_digits && fractional_is_digits
}

/// The pitfall a plain scalar falls into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalarPitfall {
    /// A YAML 1.1 boolean, or a boolean not in lowercase.
    P1,
    /// A number not written in plain decimal.
    P2,
    /// A number or timestamp for YAML 1.1, a string for YAML 1.2.
    P3,
    /// A YAML 1.1 value or merge key.
    P4,
}

/// The expressions of P1 to P4, built once per load.
#[derive(Debug)]
pub struct PitfallPatterns {
    p1: Regex,
    p2_plain_decimal: Regex,
    p3_number: Regex,
    p3_timestamp: Regex,
    p4: Regex,
}

impl PitfallPatterns {
    /// Builds the five expressions.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when one does not compile: they are constants of this crate.
    #[track_caller]
    pub fn new() -> Result<Self, InternalError> {
        Ok(Self {
            p1: compiled(P1)?,
            p2_plain_decimal: compiled(P2_PLAIN_DECIMAL)?,
            p3_number: compiled(P3_NUMBER)?,
            p3_timestamp: compiled(P3_TIMESTAMP)?,
            p4: compiled(P4)?,
        })
    }

    /// The pitfall of a plain scalar. `source` is the scalar as written and `resolved` what the
    /// core schema made of it: P2 applies to a scalar the schema reads as a number.
    #[must_use]
    pub fn load_scalar_pitfall(
        &self,
        source: &str,
        resolved: &ResolvedScalar,
    ) -> Option<ScalarPitfall> {
        if matches(&self.p1, source) {
            return Some(ScalarPitfall::P1);
        }

        if matches(&self.p4, source) {
            return Some(ScalarPitfall::P4);
        }

        if resolved.is_number() {
            return if matches(&self.p2_plain_decimal, source) {
                None
            } else {
                Some(ScalarPitfall::P2)
            };
        }

        if matches(&self.p3_number, source) || matches(&self.p3_timestamp, source) {
            return Some(ScalarPitfall::P3);
        }

        None
    }
}

#[track_caller]
fn compiled(pattern: &str) -> Result<Regex, InternalError> {
    Regex::new(pattern).map_err(|error| {
        InternalError::new(format!(
            "pitfall pattern '{pattern}' does not compile: {error}"
        ))
    })
}

fn matches(pattern: &Regex, text: &str) -> bool {
    pattern.find(text).is_some()
}

#[cfg(test)]
mod tests;
