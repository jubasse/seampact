//! The apis a target entry names: `api` or `apis`, each as `<source>/<api>` or the api alone.

use crate::target_entry_settings::TargetEntrySettings;

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

impl TargetEntrySettings {
    /// The entry's `apis`, else its `api` as a one-item list, else none.
    #[must_use]
    pub fn api_refs(&self) -> Vec<&str> {
        match (&self.apis, &self.api) {
            (Some(apis), _) => apis.iter().map(String::as_str).collect(),
            (None, Some(api)) => vec![api.as_str()],
            (None, None) => Vec::new(),
        }
    }
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
