//! Exact decimals for the refinement checks of examples: a bound is a decimal literal string and a
//! value a JSON number or an int64 or decimal string, compared without rounding.

use std::cmp::Ordering;

use num_bigint::{BigInt, Sign};
use seampact_diagnostics::InternalError;
use seampact_js::FiniteNumber;
use seampact_pipeline::PassError;

/// The ten the units are scaled by.
const TEN: u8 = 10;

/// The most decimal digits a power of ten may have: V8 throws a `RangeError` for a `bigint` past
/// 2^30 bits, which the TypeScript never catches.
const MAX_POWER_OF_TEN: u32 = 323_228_496;

/// The value `units / 10^scale`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeSchemasDecimal {
    pub(crate) units: BigInt,
    pub(crate) scale: i64,
}

/// A decimal text or a number, a number read through its shortest form.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TreeSchemasDecimalSource<'text> {
    Number(f64),
    Text(&'text str),
}

/// The exact value of a decimal text or of a number's shortest form (`1e-7` included); `None` for
/// other text.
pub(crate) fn tree_schemas_decimal_of(
    value: TreeSchemasDecimalSource<'_>,
) -> Result<Option<TreeSchemasDecimal>, PassError> {
    let text = match value {
        TreeSchemasDecimalSource::Number(number) => match FiniteNumber::new(number) {
            Some(finite) => finite.to_string(),
            None => return Ok(None),
        },
        TreeSchemasDecimalSource::Text(text) => text.to_owned(),
    };
    let Some(parts) = DecimalParts::read(&text) else {
        return Ok(None);
    };
    let digits = format!("{}{}{}", parts.sign, parts.whole, parts.fraction);
    let units: BigInt = digits.parse().map_err(|_| beyond_bigint(&text))?;
    let exponent: i64 = parts.exponent.parse().map_err(|_| beyond_bigint(&text))?;
    let fraction_length = i64::try_from(parts.fraction.len()).map_err(|_| beyond_bigint(&text))?;
    let scale = fraction_length
        .checked_sub(exponent)
        .ok_or_else(|| beyond_bigint(&text))?;

    if scale >= 0 {
        return Ok(Some(TreeSchemasDecimal { units, scale }));
    }

    let factor = power_of_ten(scale.checked_neg().ok_or_else(|| beyond_bigint(&text))?)?;

    Ok(Some(TreeSchemasDecimal {
        units: units * factor,
        scale: 0,
    }))
}

fn beyond_bigint(text: &str) -> PassError {
    PassError::from(InternalError::new(format!(
        "tree.schemas reads the decimal {text:?} past what a bigint holds, which no example reaches"
    )))
}

/// `10n ** BigInt(steps)`, refused where V8 throws.
fn power_of_ten(steps: i64) -> Result<BigInt, PassError> {
    let exponent = u32::try_from(steps)
        .ok()
        .filter(|exponent| *exponent <= MAX_POWER_OF_TEN)
        .ok_or_else(|| {
            PassError::from(InternalError::new(format!(
                "tree.schemas scales a decimal by 10^{steps}, past what a bigint holds, which no example reaches"
            )))
        })?;

    Ok(BigInt::from(TEN).pow(exponent))
}

/// The groups of the decimal text: sign, whole digits, fraction digits and exponent, as written.
struct DecimalParts<'text> {
    sign: &'text str,
    whole: &'text str,
    fraction: &'text str,
    exponent: &'text str,
}

impl<'text> DecimalParts<'text> {
    /// Splits a text of the form `-?[0-9]+(.[0-9]+)?([eE][+-]?[0-9]+)?`, else `None`.
    fn read(text: &'text str) -> Option<Self> {
        let (sign, unsigned) = match text.strip_prefix('-') {
            Some(rest) => ("-", rest),
            None => ("", text),
        };
        let (whole, after_whole) = split_digits(unsigned)?;
        let (fraction, after_fraction) = match after_whole.strip_prefix('.') {
            Some(rest) => split_digits(rest)?,
            None => ("", after_whole),
        };
        let exponent = match after_fraction.strip_prefix(['e', 'E']) {
            Some(rest) => {
                let digits_at = usize::from(rest.starts_with(['+', '-']));
                let (_, after_digits) = split_digits(rest.get(digits_at..)?)?;

                if !after_digits.is_empty() {
                    return None;
                }

                rest
            }
            None if after_fraction.is_empty() => "0",
            None => return None,
        };

        Some(Self {
            sign,
            whole,
            fraction,
            exponent,
        })
    }
}

/// The leading run of ASCII digits (at least one) and what follows it.
fn split_digits(text: &str) -> Option<(&str, &str)> {
    let length = text.bytes().take_while(u8::is_ascii_digit).count();

    if length == 0 {
        return None;
    }

    text.split_at_checked(length)
}

fn aligned(a: &TreeSchemasDecimal, b: &TreeSchemasDecimal) -> Result<(BigInt, BigInt), PassError> {
    let scale = a.scale.max(b.scale);

    Ok((units_at(a, scale)?, units_at(b, scale)?))
}

/// The units of `decimal` once written at `scale`, which is not below its own.
fn units_at(decimal: &TreeSchemasDecimal, scale: i64) -> Result<BigInt, PassError> {
    let steps = scale.checked_sub(decimal.scale).ok_or_else(|| {
        PassError::from(InternalError::new(format!(
            "tree.schemas aligns a decimal of scale {} past what a number holds",
            decimal.scale
        )))
    })?;

    Ok(&decimal.units * power_of_ten(steps)?)
}

/// `Less` when `a` is below `b`, `Equal` when equal, `Greater` when above.
pub(crate) fn tree_schemas_compare_decimals(
    a: &TreeSchemasDecimal,
    b: &TreeSchemasDecimal,
) -> Result<Ordering, PassError> {
    let (left, right) = aligned(a, b)?;

    Ok(left.cmp(&right))
}

/// Whether `value` is a whole multiple of a non-zero `step`.
pub(crate) fn tree_schemas_is_multiple_of(
    value: &TreeSchemasDecimal,
    step: &TreeSchemasDecimal,
) -> Result<bool, PassError> {
    let (units, step_units) = aligned(value, step)?;

    Ok(step_units.sign() != Sign::NoSign && (units % step_units).sign() == Sign::NoSign)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decimal(text: &str) -> TreeSchemasDecimal {
        match tree_schemas_decimal_of(TreeSchemasDecimalSource::Text(text)) {
            Ok(Some(read)) => read,
            other => panic!("text {text:?} gave {other:?}"),
        }
    }

    #[test]
    fn multiples_are_exact_past_128_bits_and_a_zero_step_has_none() {
        let huge = "100000000000000000000000000000000000000000000000000";
        let cases = [
            (huge, "0.5", true),
            (huge, "3", false),
            ("1", "0.3", false),
            ("0.9", "0.3", true),
            ("5", "0", false),
        ];

        for (value, step, expected) in cases {
            assert_eq!(
                tree_schemas_is_multiple_of(&decimal(value), &decimal(step)),
                Ok(expected),
                "{value} by {step}"
            );
        }
    }

    #[test]
    fn decimals_compare_across_scales_without_rounding() {
        let cases = [
            ("1.10", "1.1", Ordering::Equal),
            (
                "0.1",
                "0.10000000000000000000000000000000000000000001",
                Ordering::Less,
            ),
            (
                "-1",
                "-1.0000000000000000000000000000000000000000001",
                Ordering::Greater,
            ),
        ];

        for (left, right, expected) in cases {
            assert_eq!(
                tree_schemas_compare_decimals(&decimal(left), &decimal(right)),
                Ok(expected),
                "{left} against {right}"
            );
        }
    }
}
