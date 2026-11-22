//! Decimal literals of the IR, compared exactly as scaled integers.

use std::cmp::Ordering;

use num_bigint::BigInt;
use seampact_diagnostics::InternalError;

use crate::DiffError;

/// The ten the units are scaled by.
const TEN: u8 = 10;

/// The value `units / 10^scale`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ScaledDecimal {
    units: BigInt,
    scale: usize,
}

/// Reads a literal as `BigInt` reads its digits: an empty digit run is zero, any other character
/// than a digit makes the TypeScript throw, which is an internal error here.
fn parse_decimal(literal: &str) -> Result<ScaledDecimal, DiffError> {
    let (negative, digits) = match literal.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, literal),
    };
    let mut parts = digits.split('.');
    let whole = parts.next().unwrap_or("0");
    let fraction = parts.next().unwrap_or("");
    let joined = format!("{whole}{fraction}");
    let units = if joined.is_empty() {
        BigInt::from(0)
    } else {
        joined
            .parse::<BigInt>()
            .map_err(|_| InternalError::new(format!("{literal:?} is not a decimal literal")))?
    };

    Ok(ScaledDecimal {
        units: if negative { -units } else { units },
        scale: fraction.chars().count(),
    })
}

fn at_scale(decimal: &ScaledDecimal, scale: usize) -> Result<BigInt, DiffError> {
    let steps = u32::try_from(scale.saturating_sub(decimal.scale))
        .map_err(|_| InternalError::new("a decimal scale is past what a bigint holds"))?;

    Ok(&decimal.units * BigInt::from(TEN).pow(steps))
}

/// Whether `left` is below, equal to or above `right`, without rounding.
pub(crate) fn compare_decimals(left: &str, right: &str) -> Result<Ordering, DiffError> {
    let left_decimal = parse_decimal(left)?;
    let right_decimal = parse_decimal(right)?;
    let scale = left_decimal.scale.max(right_decimal.scale);

    Ok(at_scale(&left_decimal, scale)?.cmp(&at_scale(&right_decimal, scale)?))
}

/// Whether `multiple` is a whole multiple of `divisor`; a zero divisor divides nothing.
pub(crate) fn is_decimal_multiple(multiple: &str, divisor: &str) -> Result<bool, DiffError> {
    let multiple_decimal = parse_decimal(multiple)?;
    let divisor_decimal = parse_decimal(divisor)?;
    let scale = multiple_decimal.scale.max(divisor_decimal.scale);
    let divisor_units = at_scale(&divisor_decimal, scale)?;

    if divisor_units == BigInt::from(0) {
        return Ok(false);
    }

    Ok((at_scale(&multiple_decimal, scale)? % divisor_units) == BigInt::from(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(left: &str, right: &str) -> Ordering {
        compare_decimals(left, right).unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn decimals_compare_across_scales_without_rounding() {
        assert_eq!(order("1.50", "1.5"), Ordering::Equal);
        assert_eq!(order("-0.1", "-0.10"), Ordering::Equal);
        assert_eq!(order("0.30000000000000004", "0.3"), Ordering::Greater);
        assert_eq!(order("-2", "1"), Ordering::Less);
        assert_eq!(
            order("9007199254740993", "9007199254740992"),
            Ordering::Greater
        );
    }

    #[test]
    fn an_empty_digit_run_is_zero_and_a_non_digit_is_an_error() {
        assert_eq!(order("", "0"), Ordering::Equal);
        assert!(compare_decimals("1e+21", "0").is_err());
    }

    #[test]
    fn a_multiple_is_exact_across_scales_and_a_zero_divisor_divides_nothing() {
        let multiple = |multiple: &str, divisor: &str| {
            is_decimal_multiple(multiple, divisor).unwrap_or_else(|error| panic!("{error}"))
        };

        assert!(multiple("0.5", "0.25"));
        assert!(multiple("10", "2.5"));
        assert!(multiple("-1.5", "0.5"));
        assert!(multiple("0", "3"));
        assert!(!multiple("0.3", "0.2"));
        assert!(!multiple("1", "0"));
        assert!(!multiple("0", "0.00"));
        assert!(multiple("9007199254740993", "1"));
        assert!(is_decimal_multiple("1e+21", "1").is_err());
    }
}
