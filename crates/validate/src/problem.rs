//! One conversion result, and what the converter reads from the schema that holds a failing keyword.

use seampact_authoring::Marker;
use seampact_js::cmp_utf16;
use serde_json::Value;

use crate::ajv_error::AjvError;
use crate::rules::ValidateRule;

const PROPERTIES_KEYWORD: &str = "properties";
const INCLUDE_KEY: &str = "$include";

/// What one failure says: its rule, where, what is wrong and what to do.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Problem {
    pub rule: ValidateRule,
    pub pointer: String,
    pub message: String,
    pub fix: String,
}

/// The marker the failing keyword's schema is titled with.
#[must_use]
pub(crate) fn marker_of(error: &AjvError) -> Option<Marker> {
    let title = error.parent_schema?.get("title")?.as_str()?;

    Marker::from_title(title)
}

/// The failing keyword's schema description without its closing full stop; empty when it has none.
#[must_use]
pub(crate) fn description(error: &AjvError) -> String {
    let text = error
        .parent_schema
        .and_then(|schema| schema.get("description"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    text.strip_suffix('.').unwrap_or(text).to_owned()
}

fn properties_of(error: &AjvError) -> Option<&'static serde_json::Map<String, Value>> {
    error
        .parent_schema?
        .get(PROPERTIES_KEYWORD)
        .and_then(Value::as_object)
}

/// The keywords the schema lists here, sorted, but `$include` and the refused ones.
#[must_use]
pub(crate) fn known_keywords(error: &AjvError) -> Vec<String> {
    let Some(properties) = properties_of(error) else {
        return Vec::new();
    };
    let mut known: Vec<String> = properties
        .iter()
        .filter(|(key, schema)| {
            key.as_str() != INCLUDE_KEY
                && schema.get("title").and_then(Value::as_str) != Some(Marker::Refused.title())
        })
        .map(|(key, _)| key.clone())
        .collect();

    known.sort_by(|first, second| cmp_utf16(first, second));

    known
}

/// The keys a mapping may hold, named in the fix that asks for a mapping; none when the schema
/// lists none here.
#[must_use]
pub(crate) fn mapping_keys_of(error: &AjvError, type_text: &str) -> Vec<String> {
    const MAPPING: &str = "a mapping";

    let Some(properties) = properties_of(error) else {
        return Vec::new();
    };

    if type_text != MAPPING {
        return Vec::new();
    }

    let mut keys: Vec<String> = properties.keys().cloned().collect();

    keys.sort_by(|first, second| cmp_utf16(first, second));

    keys
}
