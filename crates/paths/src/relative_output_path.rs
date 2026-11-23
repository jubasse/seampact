//! A relative POSIX path that stays inside its output root.

use std::cmp::Ordering;
use std::fmt;

use camino::Utf8Path;
use seampact_js::cmp_utf16;

use crate::unsafe_path_reason::{UnsafePathReason, output_path_problem};

/// A relative POSIX path that stays inside the root it is joined to: not empty, no `\`, no
/// absolute or drive prefix, no NUL, no empty, `.` or `..` segment.
///
/// Paths order by UTF-16 code units, the order of the TypeScript writer and its manifest.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RelativeOutputPath(String);

impl RelativeOutputPath {
    /// The path, once checked against every [`UnsafePathReason`].
    ///
    /// # Errors
    ///
    /// [`ParseOutputPathError`] with the first reason that holds, in the order of the TypeScript
    /// `unsafePathReason`, and the path as given.
    pub fn try_new(path: impl Into<String>) -> Result<Self, ParseOutputPathError> {
        let path = path.into();

        match output_path_problem(&path) {
            Some(reason) => Err(ParseOutputPathError { path, reason }),
            None => Ok(Self(path)),
        }
    }

    /// The path text, segments joined by `/`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The path, to join to an output root.
    #[must_use]
    pub fn as_path(&self) -> &Utf8Path {
        Utf8Path::new(&self.0)
    }

    /// The last segment: `c.ts` for `a/b/c.ts`.
    #[must_use]
    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or(&self.0)
    }

    /// Each directory of the path, from the outermost: `a/b/c.ts` has `a` and `a/b`.
    pub fn directories(&self) -> impl Iterator<Item = &str> {
        self.0
            .match_indices('/')
            .filter_map(|(slash, _)| self.0.get(..slash))
    }
}

impl PartialOrd for RelativeOutputPath {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for RelativeOutputPath {
    fn cmp(&self, other: &Self) -> Ordering {
        cmp_utf16(&self.0, &other.0)
    }
}

impl fmt::Display for RelativeOutputPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<Utf8Path> for RelativeOutputPath {
    fn as_ref(&self) -> &Utf8Path {
        self.as_path()
    }
}

/// A path [`RelativeOutputPath::try_new`] refuses, with the reason it gives.
#[derive(Debug, Clone, PartialEq, Eq, Hash, thiserror::Error)]
#[error("{path:?} is not a relative output path: {reason}")]
pub struct ParseOutputPathError {
    path: String,
    reason: UnsafePathReason,
}

impl ParseOutputPathError {
    /// The refused path, as given.
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// The first reason that holds.
    #[must_use]
    pub fn reason(&self) -> UnsafePathReason {
        self.reason
    }
}
