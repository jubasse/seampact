//! Authored paths: relative to the containing file, forward slashes, inside the boundary and
//! matching the case of the file on disk (ADR 0002 section 1).

use std::collections::{HashMap, HashSet};

use seampact_js::cmp_utf16;

use crate::LoadReader;

/// The workspace root as a boundary.
pub const ROOT_BOUNDARY: &str = ".";

/// Splits `path` on `/` and resolves `.` and `..` lexically; a `..` with nothing to pop stays.
pub(crate) fn normalized_segments(path: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }

        if segment == ".." && parts.last().is_some_and(|last| *last != "..") {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }

    parts
}

/// `path` without `.` and empty segments and with `..` resolved where it can be; `.` when nothing
/// is left.
#[must_use]
pub fn load_normalize_path(path: &str) -> String {
    let parts = normalized_segments(path);

    if parts.is_empty() {
        return ROOT_BOUNDARY.to_owned();
    }

    parts.join("/")
}

/// The directory of `file`, `.` for a file at the root.
#[must_use]
pub fn dirname_of(file: &str) -> &str {
    match file.rfind('/') {
        Some(index) => file.get(..index).unwrap_or(ROOT_BOUNDARY),
        None => ROOT_BOUNDARY,
    }
}

/// `rel` below `dir`, normalised.
#[must_use]
pub fn join_path(dir: &str, rel: &str) -> String {
    if dir == ROOT_BOUNDARY {
        return load_normalize_path(rel);
    }

    load_normalize_path(&format!("{dir}/{rel}"))
}

/// An absolute path in any of its forms: POSIX, UNC (`//host/share`) or a drive (`D:`).
#[must_use]
pub fn is_absolute_path(path: &str) -> bool {
    path.starts_with('/') || has_drive_prefix(path)
}

fn has_drive_prefix(path: &str) -> bool {
    let mut characters = path.chars();

    characters
        .next()
        .is_some_and(|letter| letter.is_ascii_alphabetic())
        && characters.next() == Some(':')
}

/// Whether `file` is inside `boundary`; `.` is the workspace root.
///
/// `file` is root-relative; a reader gives an absolute path for a real path it cannot express from
/// the root (another drive, a UNC share), and an absolute path is never inside.
#[must_use]
pub fn is_inside(boundary: &str, file: &str) -> bool {
    if is_absolute_path(file) {
        return false;
    }

    if boundary == ROOT_BOUNDARY {
        return file != ".." && !file.starts_with("../");
    }

    file == boundary
        || file
            .strip_prefix(boundary)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Why an authored path is refused before it is resolved against the disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PathProblem {
    /// A POSIX, UNC or drive path.
    Absolute,
    /// A path written with `\`.
    Backslash,
    /// A path that leaves its boundary.
    Escape,
    /// An empty path.
    Empty,
}

/// An authored path resolved against the file that holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPath {
    /// The root-relative path.
    pub path: String,
    /// The text after the first `#`, when the site names part of the file.
    pub fragment: Option<String>,
}

/// Resolves `raw` (`path` or `path#/pointer`) against the file that contains it.
///
/// # Errors
///
/// The [`PathProblem`] that refuses the path.
pub fn resolve_authored_path(
    from_file: &str,
    raw: &str,
    boundary: &str,
) -> Result<ResolvedPath, PathProblem> {
    let (target, fragment) = match raw.split_once('#') {
        Some((target, fragment)) => (target, Some(fragment.to_owned())),
        None => (raw, None),
    };

    if target.is_empty() {
        return Err(PathProblem::Empty);
    }

    if target.contains('\\') {
        return Err(PathProblem::Backslash);
    }

    if is_absolute_path(target) {
        return Err(PathProblem::Absolute);
    }

    let resolved = join_path(dirname_of(from_file), target);

    if !is_inside(boundary, &resolved) {
        return Err(PathProblem::Escape);
    }

    Ok(ResolvedPath {
        path: resolved,
        fragment,
    })
}

/// How a path compares with the directory listings below its boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaseCheck {
    /// Every segment exists with the case written.
    Ok,
    /// A segment or a directory is not on disk.
    Missing,
    /// A directory the path crosses leaves the boundary (a symbolic link).
    Escape,
    /// A segment exists with another case; `actual` is the path as the disk spells it.
    Case {
        /// The root-relative path as the disk spells it.
        actual: String,
    },
}

/// The names of one directory listing, and per lowercase name the first in sorted order.
#[derive(Debug)]
struct ListingIndex {
    names: HashSet<String>,
    folded: HashMap<String, String>,
}

impl ListingIndex {
    fn new(entries: &[String]) -> Self {
        let mut sorted: Vec<&String> = entries.iter().collect();

        sorted.sort_by(|left, right| cmp_utf16(left, right));

        let mut folded: HashMap<String, String> = HashMap::new();

        for entry in sorted {
            folded
                .entry(entry.to_lowercase())
                .or_insert_with(|| entry.clone());
        }

        Self {
            names: entries.iter().cloned().collect(),
            folded,
        }
    }
}

/// The index of each directory, built once from the reader's listing: a directory named by many
/// paths is listed and searched once. A load owns one, as it owns one view of the disk.
#[derive(Debug, Default)]
pub struct ListingIndexes {
    by_directory: HashMap<String, Option<ListingIndex>>,
}

impl ListingIndexes {
    /// No directory listed yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn of(&mut self, reader: &dyn LoadReader, directory: &str) -> Option<&ListingIndex> {
        self.by_directory
            .entry(directory.to_owned())
            .or_insert_with(|| {
                reader
                    .list_dir(directory)
                    .map(|entries| ListingIndex::new(&entries))
            })
            .as_ref()
    }
}

/// Checks every segment of `file` below `boundary` against the directory listing, so a
/// case-insensitive disk cannot hide a mismatch.
///
/// `inside` is asked about each directory before it is listed, so a directory reached through a
/// link that leaves the boundary is never listed. `file` is inside `boundary` (lexically), and the
/// boundary itself was built by the loader.
#[must_use]
pub fn check_case(
    reader: &dyn LoadReader,
    indexes: &mut ListingIndexes,
    file: &str,
    boundary: &str,
    inside: impl Fn(&str) -> bool,
) -> CaseCheck {
    let mut current = if boundary == ROOT_BOUNDARY {
        String::new()
    } else {
        boundary.to_owned()
    };
    let mut actual: Vec<String> = Vec::new();
    let mut mismatch = false;

    if !current.is_empty() {
        actual.push(current.clone());
    }

    let rest = if current.is_empty() {
        file
    } else {
        // Past the end reads as empty, as a JavaScript slice does.
        file.get(current.len() + 1..).unwrap_or("")
    };

    for segment in rest.split('/') {
        let directory = if current.is_empty() {
            ROOT_BOUNDARY
        } else {
            current.as_str()
        };

        if !inside(directory) {
            return CaseCheck::Escape;
        }

        let Some(index) = indexes.of(reader, directory) else {
            return CaseCheck::Missing;
        };

        let name = if index.names.contains(segment) {
            segment
        } else {
            let Some(hit) = index.folded.get(&segment.to_lowercase()) else {
                return CaseCheck::Missing;
            };

            mismatch = true;
            hit.as_str()
        };

        actual.push(name.to_owned());
        current = if current.is_empty() {
            name.to_owned()
        } else {
            format!("{current}/{name}")
        };
    }

    if mismatch {
        return CaseCheck::Case {
            actual: actual.join("/"),
        };
    }

    CaseCheck::Ok
}

/// The segments of a JSON Pointer, unescaped; `None` for text that is not a pointer.
#[must_use]
pub fn pointer_segments(pointer: &str) -> Option<Vec<String>> {
    if pointer.is_empty() {
        return Some(Vec::new());
    }

    let body = pointer.strip_prefix('/')?;

    Some(
        body.split('/')
            .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
            .collect(),
    )
}
