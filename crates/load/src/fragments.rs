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
