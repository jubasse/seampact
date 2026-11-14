//! The failures that stop the oracle before a verdict: a file it cannot read or a tree it refuses.

use camino::Utf8PathBuf;

/// Why the oracle could not reach a verdict.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum OracleError {
    /// A file or directory could not be read.
    #[error("cannot read {path}: {source}")]
    Read {
        /// The file or directory.
        path: Utf8PathBuf,
        /// The I/O failure.
        source: std::io::Error,
    },
    /// A path under the repository is not UTF-8.
    #[error("{path} is not a UTF-8 path")]
    NonUtf8Path {
        /// The path, lossily decoded.
        path: String,
    },
    /// An expected output or a repository JSON file is no JSON.
    #[error("{path} is no JSON: {source}")]
    Json {
        /// The file.
        path: Utf8PathBuf,
        /// The parse failure.
        source: serde_json::Error,
    },
    /// A repository file (`excluded.json`, `rule-coverage.json`) does not have the shape the
    /// oracle reads.
    #[error("{path}: {problem}")]
    Shape {
        /// The file.
        path: Utf8PathBuf,
        /// What is wrong, and the fix.
        problem: String,
    },
    /// A fixture is nested in another under a name the expected outputs use.
    #[error(
        "fixture {fixture} is nested in {parent} under a name its expected outputs use; rename its directory"
    )]
    CollidingFixture {
        /// The nested fixture.
        fixture: String,
        /// The fixture it is nested in.
        parent: String,
    },
    /// The command line selects nothing: a glob matching no fixture, a half no fixture has.
    #[error("{problem}")]
    Usage {
        /// What selects nothing.
        problem: String,
    },
    /// The thread that watches the per-fixture time limit could not be started.
    #[error("cannot start the time limit watcher: {source}")]
    Thread {
        /// The I/O failure.
        source: std::io::Error,
    },
    /// The differences file is invalid.
    #[error("{path} is invalid:\n{}", problems.iter().map(|problem| format!("  {problem}")).collect::<Vec<_>>().join("\n"))]
    InvalidDifferences {
        /// The differences file.
        path: Utf8PathBuf,
        /// Every problem, one line each.
        problems: Vec<String>,
    },
}

impl OracleError {
    /// Whether the failure is a usage error of the command line, rather than of the repository.
    #[must_use]
    pub fn is_usage(&self) -> bool {
        matches!(self, Self::Usage { .. })
    }
}
