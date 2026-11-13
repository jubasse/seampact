//! The files an include site brings into the workspace, with the kind the site expects.

use indexmap::IndexMap;
use seampact_js::cmp_utf16;
use seampact_span::Location;

/// One file an include site or a file `$ref` brings into the workspace, with the kind of mapping
/// that site expects (ADR 0002 section 3): the authoring schema an editor checks the file against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadFragment {
    /// The included file, relative to the workspace root, as the locations name files.
    pub file: String,
    /// The JSON Pointer after the path's `#`, when the site includes part of the file.
    pub pointer: Option<String>,
    /// The kind of an authoring schema file (`node-errors`); `None` when the site's position names
    /// no single authoring file.
    pub kind: Option<&'static str>,
    /// Where the path is written.
    pub at: Location,
}

/// Wide enough for any line or column a load budget admits.
const SITE_DIGITS: usize = 10;

/// Separates the parts of a sort key: no path holds it.
const KEY_SEPARATOR: char = '\0';

/// The fragments by file, pointer, then site; one entry per distinct site and kind.
#[must_use]
pub fn load_sort_fragments(fragments: &[LoadFragment]) -> Vec<LoadFragment> {
    let mut unique: IndexMap<String, &LoadFragment> = IndexMap::new();

    for fragment in fragments {
        unique.insert(fragment_key(fragment), fragment);
    }

    let mut keyed: Vec<(String, &LoadFragment)> = unique.into_iter().collect();

    keyed.sort_by(|(left, _), (right, _)| cmp_utf16(left, right));

    keyed
        .into_iter()
        .map(|(_, fragment)| fragment.clone())
        .collect()
}

// Sortable as text: each part is fixed-width or separated by a character no path holds.
fn fragment_key(fragment: &LoadFragment) -> String {
    let LoadFragment {
        file,
        pointer,
        kind,
        at,
    } = fragment;
    let position = format!("{:0>SITE_DIGITS$}:{:0>SITE_DIGITS$}", at.line, at.column);
    let parts = [
        file.as_str(),
        pointer.as_deref().unwrap_or(""),
        at.file.as_str(),
        position.as_str(),
        kind.unwrap_or(""),
    ];

    parts.join(&KEY_SEPARATOR.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fragment(
        file: &str,
        pointer: Option<&str>,
        kind: Option<&'static str>,
        site: (&str, u32, u32),
    ) -> LoadFragment {
        LoadFragment {
            file: file.to_owned(),
            pointer: pointer.map(str::to_owned),
            kind,
            at: Location {
                file: site.0.to_owned(),
                line: site.1,
                column: site.2,
                end_line: site.1,
                end_column: site.2 + 1,
            },
        }
    }

    fn files_of(fragments: &[LoadFragment]) -> Vec<&str> {
        fragments
            .iter()
            .map(|fragment| fragment.file.as_str())
            .collect()
    }

    #[test]
    fn fragments_sort_by_file_then_pointer_then_site() {
        let sorted = load_sort_fragments(&[
            fragment("b.yaml", None, Some("schemas"), ("api.yaml", 1, 1)),
            fragment("a.yaml", Some("/Z"), Some("schemas"), ("api.yaml", 1, 1)),
            fragment("a.yaml", Some("/A"), Some("schemas"), ("api.yaml", 9, 1)),
            fragment("a.yaml", Some("/A"), Some("schemas"), ("api.yaml", 10, 1)),
            fragment("a.yaml", Some("/A"), Some("schemas"), ("api.yaml", 2, 1)),
            fragment("a.yaml", Some("/A"), Some("schemas"), ("base.yaml", 1, 1)),
        ]);
        let order: Vec<(&str, Option<&str>, &str, u32)> = sorted
            .iter()
            .map(|fragment| {
                (
                    fragment.file.as_str(),
                    fragment.pointer.as_deref(),
                    fragment.at.file.as_str(),
                    fragment.at.line,
                )
            })
            .collect();

        assert_eq!(
            order,
            vec![
                ("a.yaml", Some("/A"), "api.yaml", 2),
                ("a.yaml", Some("/A"), "api.yaml", 9),
                ("a.yaml", Some("/A"), "api.yaml", 10),
                ("a.yaml", Some("/A"), "base.yaml", 1),
                ("a.yaml", Some("/Z"), "api.yaml", 1),
                ("b.yaml", None, "api.yaml", 1),
            ]
        );
    }

    #[test]
    fn one_entry_stays_per_distinct_site_and_kind() {
        let sorted = load_sort_fragments(&[
            fragment("a.yaml", None, Some("node"), ("api.yaml", 1, 1)),
            fragment("a.yaml", None, Some("node"), ("api.yaml", 1, 1)),
            fragment("a.yaml", None, Some("schema"), ("api.yaml", 1, 1)),
            fragment("a.yaml", None, None, ("api.yaml", 1, 1)),
        ]);
        let kinds: Vec<Option<&str>> = sorted.iter().map(|fragment| fragment.kind).collect();

        assert_eq!(kinds, vec![None, Some("node"), Some("schema")]);
    }

    #[test]
    fn the_last_fragment_of_a_site_wins() {
        let mut later = fragment("a.yaml", None, Some("node"), ("api.yaml", 1, 1));

        later.at.end_line = 7;

        let sorted = load_sort_fragments(&[
            fragment("a.yaml", None, Some("node"), ("api.yaml", 1, 1)),
            later.clone(),
        ]);

        assert_eq!(sorted, vec![later]);
    }

    #[test]
    fn an_absent_pointer_and_an_empty_one_are_one_site() {
        let sorted = load_sort_fragments(&[
            fragment("a.yaml", None, Some("node"), ("api.yaml", 1, 1)),
            fragment("a.yaml", Some(""), Some("node"), ("api.yaml", 1, 1)),
        ]);

        assert_eq!(sorted.len(), 1);
    }

    #[test]
    fn files_sort_in_utf16_order_not_byte_order() {
        let sorted = load_sort_fragments(&[
            fragment("\u{E000}.yaml", None, None, ("api.yaml", 1, 1)),
            fragment("\u{1F600}.yaml", None, None, ("api.yaml", 1, 1)),
            fragment("z.yaml", None, None, ("api.yaml", 1, 1)),
        ]);

        assert_eq!(
            files_of(&sorted),
            vec!["z.yaml", "\u{1F600}.yaml", "\u{E000}.yaml"]
        );
    }

    #[test]
    fn a_line_wider_than_the_padding_still_sorts_after_a_narrower_one() {
        let sorted = load_sort_fragments(&[
            fragment("a.yaml", None, None, ("api.yaml", 12_345_678, 1)),
            fragment("a.yaml", None, None, ("api.yaml", 3, 1)),
        ]);
        let lines: Vec<u32> = sorted.iter().map(|fragment| fragment.at.line).collect();

        assert_eq!(lines, vec![3, 12_345_678]);
    }
}
