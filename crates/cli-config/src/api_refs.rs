//! The apis a target entry names: `api` or `apis`, each as `<source>/<api>` or the api alone.

use seampact_json::JsonValue;

use crate::json_access::{items, record, text};

const SOURCE_SEPARATOR: char = '/';

/// An entry's `api` or `apis` item split into its source and api.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiRef<'text> {
    /// The source, when the reference writes one.
    pub source: Option<&'text str>,
    /// The api name.
    pub api: &'text str,
}

/// The api name alone, or `<source>/<api>` split at its first separator.
#[must_use]
pub fn parse_api_ref(text: &str) -> ApiRef<'_> {
    match text.split_once(SOURCE_SEPARATOR) {
        Some((source, api)) => ApiRef {
            source: Some(source),
            api,
        },
        None => ApiRef {
            source: None,
            api: text,
        },
    }
}

/// The `apis` of `entry`, else its `api` as a one-item list, else none.
#[must_use]
pub fn api_refs_of(entry: &JsonValue) -> Vec<&str> {
    let object = record(Some(entry));

    if let Some(apis) = object.and_then(|object| object.get("apis")) {
        return items(Some(apis))
            .iter()
            .filter_map(|api| text(Some(api)))
            .collect();
    }

    text(object.and_then(|object| object.get("api")))
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_splits_at_its_first_separator() {
        assert_eq!(
            parse_api_ref("shared/billing/v2"),
            ApiRef {
                source: Some("shared"),
                api: "billing/v2"
            }
        );
        assert_eq!(
            parse_api_ref("notes"),
            ApiRef {
                source: None,
                api: "notes"
            }
        );
        assert_eq!(
            parse_api_ref("/x"),
            ApiRef {
                source: Some(""),
                api: "x"
            }
        );
    }
}
