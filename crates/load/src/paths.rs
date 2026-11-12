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

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::{LoadText, MemoryReader};

    fn memory(paths: &[&str]) -> MemoryReader {
        MemoryReader::new(paths.iter().map(|path| ((*path).to_owned(), String::new())))
    }

    #[test]
    fn normalizing_drops_dots_and_resolves_parents_where_it_can() {
        let cases = [
            ("a/./b//c", "a/b/c"),
            ("a/../b", "b"),
            ("../a", "../a"),
            ("a/../../b", "../b"),
            ("../../a", "../../a"),
            ("a/..", "."),
            ("", "."),
            (".", "."),
            ("/", "."),
            ("é/😀/..", "é"),
            ("a\\b", "a\\b"),
        ];

        for (input, expected) in cases {
            assert_eq!(load_normalize_path(input), expected, "input {input:?}");
        }
    }

    #[test]
    fn dirname_and_join_keep_the_root_as_a_dot() {
        assert_eq!(dirname_of("a/b.yaml"), "a");
        assert_eq!(dirname_of("b.yaml"), ".");
        assert_eq!(dirname_of("/b.yaml"), "");
        assert_eq!(dirname_of("é/😀/x.yaml"), "é/😀");
        assert_eq!(join_path(".", "./a/../b.yaml"), "b.yaml");
        assert_eq!(join_path("sub", "../../x.yaml"), "../x.yaml");
        assert_eq!(join_path("sub", "."), "sub");
    }

    #[test]
    fn absolute_paths_are_posix_unc_or_drive_forms() {
        for absolute in ["/etc/passwd", "//host/share/x", "C:/x.yaml", "d:x", "Z:"] {
            assert!(is_absolute_path(absolute), "path {absolute:?}");
        }

        for relative in ["", "a/b", "ab:/x", "é:/x", "1:/x", "./C:/x", ":/x"] {
            assert!(!is_absolute_path(relative), "path {relative:?}");
        }
    }

    #[test]
    fn inside_the_root_means_not_leaving_it() {
        assert!(is_inside(".", "a/b"));
        assert!(is_inside(".", "."));
        assert!(is_inside(".", "..x"));
        assert!(is_inside(".", "...//x"));
        assert!(!is_inside(".", ".."));
        assert!(!is_inside(".", "../x"));
        assert!(!is_inside(".", "/x"));
        assert!(!is_inside(".", "D:/x"));
    }

    #[test]
    fn inside_a_package_means_below_its_directory() {
        let package = "node_modules/@acme/pack-a";

        assert!(is_inside(package, package));
        assert!(is_inside(package, "node_modules/@acme/pack-a/lib/x.yaml"));
        assert!(!is_inside(package, "node_modules/@acme/pack-ab/x.yaml"));
        assert!(!is_inside(package, "node_modules/@acme"));
        assert!(!is_inside(package, "../node_modules/@acme/pack-a/x.yaml"));
        assert!(!is_inside(package, "/node_modules/@acme/pack-a/x.yaml"));
    }

    #[test]
    fn path_escapes_are_refused() {
        let from = "api.yaml";
        let cases = [
            ("../outside.yaml", PathProblem::Escape),
            ("/etc/passwd", PathProblem::Absolute),
            (".\\x.yaml", PathProblem::Backslash),
            ("./sub/../../outside.yaml", PathProblem::Escape),
            ("C:/x.yaml", PathProblem::Absolute),
            ("//host/share/x.yaml", PathProblem::Absolute),
            ("", PathProblem::Empty),
            ("#/Note", PathProblem::Empty),
            ("a\\b#/Note", PathProblem::Backslash),
        ];

        for (raw, problem) in cases {
            assert_eq!(
                resolve_authored_path(from, raw, ROOT_BOUNDARY),
                Err(problem),
                "path {raw:?}"
            );
        }
    }

    #[test]
    fn a_path_resolves_against_its_file_and_keeps_the_fragment_after_the_first_hash() {
        assert_eq!(
            resolve_authored_path("sub/api.yaml", "./Sub/X.yaml", ROOT_BOUNDARY),
            Ok(ResolvedPath {
                path: "sub/Sub/X.yaml".to_owned(),
                fragment: None
            })
        );
        assert_eq!(
            resolve_authored_path("api.yaml", "./shared.yaml#/Note#/x", ROOT_BOUNDARY),
            Ok(ResolvedPath {
                path: "shared.yaml".to_owned(),
                fragment: Some("/Note#/x".to_owned())
            })
        );
        assert_eq!(
            resolve_authored_path("api.yaml", "x.yaml#", ROOT_BOUNDARY),
            Ok(ResolvedPath {
                path: "x.yaml".to_owned(),
                fragment: Some(String::new())
            })
        );
    }

    #[test]
    fn a_pack_path_stays_inside_its_package() {
        let package = "node_modules/@acme/pack-a";
        let from = "node_modules/@acme/pack-a/lib/pack.yaml";

        assert_eq!(
            resolve_authored_path(from, "../data.yaml", package),
            Ok(ResolvedPath {
                path: "node_modules/@acme/pack-a/data.yaml".to_owned(),
                fragment: None
            })
        );
        assert_eq!(
            resolve_authored_path(from, "../../../../api.yaml", package),
            Err(PathProblem::Escape)
        );
        assert_eq!(
            resolve_authored_path(from, "../../pack-b/x.yaml", package),
            Err(PathProblem::Escape)
        );
    }

    #[test]
    fn pointer_segments_unescape_slash_before_tilde() {
        assert_eq!(pointer_segments(""), Some(vec![]));
        assert_eq!(pointer_segments("/"), Some(vec![String::new()]));
        assert_eq!(
            pointer_segments("/a~1b/~0c/~01/é"),
            Some(vec![
                "a/b".to_owned(),
                "~c".to_owned(),
                "~1".to_owned(),
                "é".to_owned()
            ])
        );
        assert_eq!(pointer_segments("a"), None);
    }

    #[test]
    fn a_matching_path_is_ok() {
        let reader = memory(&["api.yaml", "sub/x.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(&reader, &mut indexes, "sub/x.yaml", ".", |_| true),
            CaseCheck::Ok
        );
    }

    #[test]
    fn a_path_that_differs_in_case_names_the_file_on_disk() {
        let reader = memory(&["sub/x.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(&reader, &mut indexes, "Sub/X.yaml", ".", |_| true),
            CaseCheck::Case {
                actual: "sub/x.yaml".to_owned()
            }
        );
        assert_eq!(
            check_case(&reader, &mut indexes, "sub/X.yaml", ".", |_| true),
            CaseCheck::Case {
                actual: "sub/x.yaml".to_owned()
            }
        );
    }

    #[test]
    fn the_case_check_works_below_a_package_boundary() {
        let reader = memory(&["node_modules/pkg/Lib/Pack.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(
                &reader,
                &mut indexes,
                "node_modules/pkg/lib/pack.yaml",
                "node_modules/pkg",
                |_| true
            ),
            CaseCheck::Case {
                actual: "node_modules/pkg/Lib/Pack.yaml".to_owned()
            }
        );
        assert_eq!(
            check_case(
                &reader,
                &mut indexes,
                "node_modules/pkg/Lib/Pack.yaml",
                "node_modules/pkg",
                |_| true
            ),
            CaseCheck::Ok
        );
    }

    #[test]
    fn two_names_that_differ_in_case_give_the_first_in_utf16_order() {
        let reader = memory(&["b.yaml", "B.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(&reader, &mut indexes, "B.YAML", ".", |_| true),
            CaseCheck::Case {
                actual: "B.yaml".to_owned()
            }
        );
        assert_eq!(
            check_case(&reader, &mut indexes, "b.yaml", ".", |_| true),
            CaseCheck::Ok
        );
    }

    #[test]
    fn the_case_fold_is_the_full_unicode_lowercase() {
        let reader = memory(&["Éa.yaml", "😀.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(&reader, &mut indexes, "éa.yaml", ".", |_| true),
            CaseCheck::Case {
                actual: "Éa.yaml".to_owned()
            }
        );
        assert_eq!(
            check_case(&reader, &mut indexes, "😀.yaml", ".", |_| true),
            CaseCheck::Ok
        );
    }

    #[test]
    fn a_missing_segment_or_directory_is_missing() {
        let reader = memory(&["sub/x.yaml"]);
        let mut indexes = ListingIndexes::new();

        for file in ["sub/y.yaml", "other/x.yaml", "sub/x.yaml/deeper", "sub"] {
            let expected = if file == "sub" {
                CaseCheck::Ok
            } else {
                CaseCheck::Missing
            };

            assert_eq!(
                check_case(&reader, &mut indexes, file, ".", |_| true),
                expected,
                "file {file:?}"
            );
        }
    }

    #[test]
    fn a_file_equal_to_its_boundary_has_no_segment_to_find() {
        let reader = memory(&["pkg/x.yaml"]);
        let mut indexes = ListingIndexes::new();

        assert_eq!(
            check_case(&reader, &mut indexes, "pkg", "pkg", |_| true),
            CaseCheck::Missing
        );
    }

    #[test]
    fn a_directory_outside_the_boundary_is_never_listed() {
        let reader = memory(&["dirlink/secret.yaml", "api.yaml"]);
        let mut indexes = ListingIndexes::new();
        let asked: Cell<Vec<String>> = Cell::new(Vec::new());
        let inside = |directory: &str| {
            let mut so_far = asked.take();

            so_far.push(directory.to_owned());
            asked.set(so_far);

            directory != "dirlink"
        };

        assert_eq!(
            check_case(&reader, &mut indexes, "dirlink/secret.yaml", ".", inside),
            CaseCheck::Escape
        );
        assert_eq!(asked.take(), vec![".".to_owned(), "dirlink".to_owned()]);
    }

    struct CountingReader {
        inner: MemoryReader,
        listings: Cell<usize>,
    }

    impl LoadReader for CountingReader {
        fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
            self.inner.read_text(file, max_bytes)
        }

        fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
            self.listings.set(self.listings.get() + 1);

            self.inner.list_dir(dir)
        }

        fn real_path(&self, file: &str) -> Option<String> {
            self.inner.real_path(file)
        }

        fn ascent(&self) -> u32 {
            self.inner.ascent()
        }
    }

    #[test]
    fn a_directory_is_listed_once_however_many_paths_it_holds() {
        let names: Vec<String> = (0..200).map(|index| format!("f{index}.yaml")).collect();
        let reader = CountingReader {
            inner: MemoryReader::new(
                names
                    .iter()
                    .map(|name| (name.clone(), String::new()))
                    .chain([("api.yaml".to_owned(), String::new())]),
            ),
            listings: Cell::new(0),
        };
        let mut indexes = ListingIndexes::new();

        for name in &names {
            assert_eq!(
                check_case(&reader, &mut indexes, name, ".", |_| true),
                CaseCheck::Ok
            );
        }

        assert_eq!(reader.listings.get(), 1);

        assert_eq!(
            check_case(&reader, &mut indexes, "f0.yaml/x.yaml", ".", |_| true),
            CaseCheck::Missing
        );
        assert_eq!(
            check_case(&reader, &mut indexes, "f0.yaml/y.yaml", ".", |_| true),
            CaseCheck::Missing
        );
        assert_eq!(reader.listings.get(), 2);
    }
}
