//! IR integer members read with JavaScript semantics: `404`, `404.0` and `4.04e2` are one integer.

use std::ops::RangeInclusive;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer};

use crate::{JsonError, JsonNumber, JsonValue, canonical_json};

/// The largest integer JavaScript holds exactly, `Number.MAX_SAFE_INTEGER` (2^53 - 1).
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// The smallest integer JavaScript holds exactly, `Number.MIN_SAFE_INTEGER`.
pub const MIN_SAFE_INTEGER: i64 = -MAX_SAFE_INTEGER;

/// The `i64` of `number` when `Number.isInteger` holds and it is within `allowed`.
///
/// `allowed` is the integer definition's `minimum` and `maximum`; a bound outside the safe range
/// is narrowed to it. The check is made on the `f64` JavaScript holds, so `1e-17` is refused and
/// an exact integer above 2^53 is outside every allowed range.
///
/// # Errors
///
/// [`JsonError::NotAnIntegerInRange`] when the number has a fraction or is outside the range.
pub fn js_integer_in_range(
    number: &JsonNumber,
    allowed: RangeInclusive<i64>,
) -> Result<i64, JsonError> {
    let allowed = safe_part_of(allowed);
    number
        .integer_within(&allowed)
        .ok_or_else(|| JsonError::NotAnIntegerInRange {
            found: number.to_string(),
            allowed,
        })
}

/// Reads an IR integer member: any JSON number that is an integer in the safe range and within
/// `MIN..=MAX`, the definition's bounds.
///
/// Use as `#[serde(deserialize_with = "js_integer::<_, 0, 599>")]`; for a negative bound, write it in
/// braces (`js_integer::<_, { -1 }, 10>`).
///
/// # Errors
///
/// A decode error naming the value and the range, for a value that is no number, has a fraction
/// or is outside the range.
pub fn js_integer<'de, D, const MIN: i64, const MAX: i64>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = JsonValue::deserialize(deserializer)?;

    js_integer_of_value(&value, MIN..=MAX).map_err(D::Error::custom)
}

/// Reads an optional IR integer member, as [`js_integer`] does; pair it with `#[serde(default)]`.
///
/// # Errors
///
/// As [`js_integer`], `null` included: an absent member is the only `None`.
pub fn optional_js_integer<'de, D, const MIN: i64, const MAX: i64>(
    deserializer: D,
) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    js_integer::<D, MIN, MAX>(deserializer).map(Some)
}

fn js_integer_of_value(value: &JsonValue, allowed: RangeInclusive<i64>) -> Result<i64, JsonError> {
    let JsonValue::Number(number) = value else {
        return Err(JsonError::NotAnIntegerInRange {
            found: canonical_json(value),
            allowed: safe_part_of(allowed),
        });
    };

    js_integer_in_range(number, allowed)
}

fn safe_part_of(allowed: RangeInclusive<i64>) -> RangeInclusive<i64> {
    let (minimum, maximum) = allowed.into_inner();

    minimum.max(MIN_SAFE_INTEGER)..=maximum.min(MAX_SAFE_INTEGER)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct ErrorHttp {
        #[serde(deserialize_with = "js_integer::<_, 100, 599>")]
        status: i64,
        #[serde(default, deserialize_with = "optional_js_integer::<_, { -10 }, 10>")]
        offset: Option<i64>,
    }

    fn status_of(text: &str) -> Result<i64, String> {
        serde_json::from_str::<ErrorHttp>(&format!(r#"{{"status": {text}}}"#))
            .map(|decoded| decoded.status)
            .map_err(|error| error.to_string())
    }

    fn number(text: &str) -> JsonNumber {
        JsonNumber::from_json_text(text).unwrap()
    }

    #[test]
    fn every_written_form_of_an_integer_reads_alike() {
        assert_eq!(status_of("404"), Ok(404));
        assert_eq!(status_of("404.0"), Ok(404));
        assert_eq!(status_of("4.04e2"), Ok(404));
    }

    #[test]
    fn a_fraction_is_refused() {
        let error = js_integer_in_range(&number("1e-17"), 0..=10).unwrap_err();

        assert_eq!(
            error,
            JsonError::NotAnIntegerInRange {
                found: "1e-17".to_owned(),
                allowed: 0..=10
            }
        );
        assert!(
            status_of("404.5")
                .unwrap_err()
                .contains("expected an integer from 100 to 599, found 404.5")
        );
    }

    #[test]
    fn values_outside_the_definition_bounds_are_refused() {
        assert!(status_of("99").is_err());
        assert!(status_of("600").is_err());
        assert_eq!(status_of("599"), Ok(599));
    }

    #[test]
    fn values_outside_the_safe_range_are_refused() {
        let everything = i64::MIN..=i64::MAX;

        assert_eq!(
            js_integer_in_range(&number("9007199254740991"), everything.clone()),
            Ok(MAX_SAFE_INTEGER)
        );
        assert_eq!(
            js_integer_in_range(&number("-9007199254740991"), everything.clone()),
            Ok(MIN_SAFE_INTEGER)
        );
        assert!(js_integer_in_range(&number("9007199254740992"), everything.clone()).is_err());
        assert!(js_integer_in_range(&number("9007199254740993"), everything).is_err());
    }

    #[test]
    fn negative_zero_reads_as_zero() {
        assert_eq!(js_integer_in_range(&number("-0"), 0..=0), Ok(0));
    }

    #[test]
    fn a_non_number_is_refused() {
        assert!(status_of(r#""404""#).is_err());
        assert!(status_of("null").is_err());
    }

    #[test]
    fn an_optional_member_reads_absent_as_none_and_present_as_its_integer() {
        let absent: ErrorHttp = serde_json::from_str(r#"{"status": 200}"#).unwrap();
        let present: ErrorHttp =
            serde_json::from_str(r#"{"status": 200, "offset": -1.0}"#).unwrap();

        assert_eq!(absent.offset, None);
        assert_eq!(present.offset, Some(-1));
        assert!(serde_json::from_str::<ErrorHttp>(r#"{"status": 200, "offset": -11}"#).is_err());
    }
}
