//! A YAML document read as a JSON value under the YAML 1.2 core schema, integers kept exact.

use saphyr_parser::{Event, Parser, ScalarStyle};
use seampact_js::FiniteNumber;
use serde_json::{Map, Number, Value};

/// Reads the single document of `text` as a JSON value: plain scalars resolved by the core schema
/// (`null`, booleans, integers with their exact digits, floats as ECMAScript writes them), every
/// other scalar a string.
///
/// # Errors
///
/// A one-line problem: a YAML syntax error, an alias, a tag, a mapping key that is no scalar, a
/// duplicate key, or a float that is no finite number.
pub fn yaml_to_json(text: &str) -> Result<Value, String> {
    let mut events = Parser::new_from_str(text).map(|result| {
        result
            .map(|(event, _)| event)
            .map_err(|error| error.to_string())
    });

    let mut document = None;

    while let Some(event) = events.next() {
        match event? {
            Event::StreamStart | Event::StreamEnd | Event::DocumentEnd | Event::Nothing => {}
            Event::DocumentStart(_) if document.is_some() => {
                return Err("the file holds more than one YAML document".to_owned());
            }
            Event::DocumentStart(_) => document = Some(read_node(&mut events, None)?),
            other => return Err(format!("unexpected YAML event {other:?}")),
        }
    }

    Ok(document.unwrap_or(Value::Null))
}

/// Reads one node; `first` is its first event when the caller has already taken it.
fn read_node<'input>(
    events: &mut impl Iterator<Item = Result<Event<'input>, String>>,
    first: Option<Event<'input>>,
) -> Result<Value, String> {
    let event = match first {
        Some(event) => event,
        None => events
            .next()
            .ok_or_else(|| "the YAML document ends early".to_owned())??,
    };

    match event {
        Event::Scalar(text, style, _, None) => scalar_value(&text, style),
        Event::SequenceStart(_, None) => read_sequence(events),
        Event::MappingStart(_, None) => read_mapping(events),
        Event::Alias(_) => Err("YAML aliases are not read; write the value out".to_owned()),
        Event::Scalar(_, _, _, Some(_))
        | Event::SequenceStart(_, Some(_))
        | Event::MappingStart(_, Some(_)) => {
            Err("YAML tags are not read; write the value untagged".to_owned())
        }
        other => Err(format!("unexpected YAML event {other:?}")),
    }
}

fn read_sequence<'input>(
    events: &mut impl Iterator<Item = Result<Event<'input>, String>>,
) -> Result<Value, String> {
    let mut items = Vec::new();

    loop {
        let event = next_event(events)?;

        if event == Event::SequenceEnd {
            return Ok(Value::Array(items));
        }

        items.push(read_node(events, Some(event))?);
    }
}

fn read_mapping<'input>(
    events: &mut impl Iterator<Item = Result<Event<'input>, String>>,
) -> Result<Value, String> {
    let mut members = Map::new();

    loop {
        let key = match next_event(events)? {
            Event::MappingEnd => return Ok(Value::Object(members)),
            Event::Scalar(key, _, _, None) => key.into_owned(),
            _ => return Err("a YAML mapping key is not a plain scalar".to_owned()),
        };

        let value = read_node(events, None)?;

        if members.insert(key.clone(), value).is_some() {
            return Err(format!("the YAML mapping key '{key}' is used twice"));
        }
    }
}

fn next_event<'input>(
    events: &mut impl Iterator<Item = Result<Event<'input>, String>>,
) -> Result<Event<'input>, String> {
    events
        .next()
        .ok_or_else(|| "the YAML document ends early".to_owned())?
}

/// The JSON value of a scalar: quoted and block scalars are strings, plain ones go through the
/// core schema.
fn scalar_value(text: &str, style: ScalarStyle) -> Result<Value, String> {
    if style != ScalarStyle::Plain {
        return Ok(Value::String(text.to_owned()));
    }

    match text {
        "" | "~" | "null" | "Null" | "NULL" => return Ok(Value::Null),
        "true" | "True" | "TRUE" => return Ok(Value::Bool(true)),
        "false" | "False" | "FALSE" => return Ok(Value::Bool(false)),
        _ => {}
    }

    if let Some(integer_digits) = core_integer_digits(text) {
        return number_of_text(&integer_digits);
    }

    if is_core_float(text) {
        return float_value(text);
    }

    Ok(Value::String(text.to_owned()))
}

/// The decimal digits of a core-schema integer (`-12`, `+7`, `0o17`, `0x1F`), or `None`.
fn core_integer_digits(text: &str) -> Option<String> {
    if let Some(octal_digits) = text.strip_prefix("0o") {
        return radix_digits(octal_digits, 8);
    }

    if let Some(hexadecimal_digits) = text.strip_prefix("0x") {
        return radix_digits(hexadecimal_digits, 16);
    }

    let (sign, unsigned_digits) = match text.split_at_checked(1) {
        Some(("-", rest)) => ("-", rest),
        Some(("+", rest)) => ("", rest),
        _ => ("", text),
    };

    if unsigned_digits.is_empty() || !unsigned_digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }

    let significant_digits = unsigned_digits.trim_start_matches('0');

    if significant_digits.is_empty() {
        return Some("0".to_owned());
    }

    Some(format!("{sign}{significant_digits}"))
}

fn radix_digits(digits: &str, radix: u32) -> Option<String> {
    u128::from_str_radix(digits, radix)
        .ok()
        .map(|value| value.to_string())
}

/// Whether `text` is a core-schema float: `[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?`
/// or one of the infinities and NaNs.
fn is_core_float(text: &str) -> bool {
    let unsigned = text.strip_prefix(['-', '+']).unwrap_or(text);

    if matches!(unsigned, ".inf" | ".Inf" | ".INF") || matches!(text, ".nan" | ".NaN" | ".NAN") {
        return true;
    }

    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (unsigned, None),
    };

    let exponent_is_valid = exponent.is_none_or(|exponent| {
        let exponent_digits = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);

        !exponent_digits.is_empty() && exponent_digits.bytes().all(|byte| byte.is_ascii_digit())
    });

    let (whole_digits, fraction_digits) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let are_digits = |digits: &str| digits.bytes().all(|byte| byte.is_ascii_digit());
    let mantissa_is_valid = are_digits(whole_digits)
        && are_digits(fraction_digits)
        && (!whole_digits.is_empty() || !fraction_digits.is_empty());

    exponent_is_valid && mantissa_is_valid
}

fn float_value(text: &str) -> Result<Value, String> {
    let not_finite = || format!("the YAML number {text} is no finite JSON number");

    let parsed = text
        .strip_prefix('+')
        .unwrap_or(text)
        .parse::<f64>()
        .map_err(|_| not_finite())?;
    let finite = FiniteNumber::new(parsed).ok_or_else(not_finite)?;

    number_of_text(&finite.to_string())
}

/// The JSON number of a JSON number text, its token kept.
fn number_of_text(text: &str) -> Result<Value, String> {
    serde_json::from_str::<Number>(text)
        .map(Value::Number)
        .map_err(|error| format!("the YAML number {text} is no JSON number: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Value {
        yaml_to_json(text).unwrap()
    }

    #[test]
    fn plain_scalars_follow_the_core_schema_and_integers_keep_their_digits() {
        assert_eq!(
            read("a: 9223372036854775807\nb: '12'\nc: ~\nd: true\ne: 1.50\nf: 0x1F\ng: +007\nh: 1e3\ni: x y"),
            serde_json::from_str::<Value>(
                r#"{"a": 9223372036854775807, "b": "12", "c": null, "d": true, "e": 1.5, "f": 31, "g": 7, "h": 1000, "i": "x y"}"#
            )
            .unwrap()
        );
    }

    #[test]
    fn flow_collections_and_nested_mappings_are_read() {
        assert_eq!(
            read("applies: { fixtures: [\"a/**\"], output: ir }\nlist:\n  - 1\n  - [2]"),
            serde_json::from_str::<Value>(
                r#"{"applies": {"fixtures": ["a/**"], "output": "ir"}, "list": [1, [2]]}"#
            )
            .unwrap()
        );
    }

    #[test]
    fn aliases_tags_duplicate_keys_and_infinities_are_refused() {
        assert!(yaml_to_json("a: &x 1\nb: *x").is_err());
        assert!(yaml_to_json("a: !!str 1").is_err());
        assert!(yaml_to_json("a: 1\na: 2").is_err());
        assert!(yaml_to_json("a: .inf").is_err());
    }
}
