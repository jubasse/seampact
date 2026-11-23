//! The failures of fetching a bundle source before the pinned-bundle check reads it.

use seampact_bundle::{BundleFailure, BundleFailureCode};
use seampact_bundle_source::{BundleSource, BundleSourceForm};
use seampact_diagnostics::{diagnostic_inert, quote_text};

use crate::printable_url::printable_url;

/// The code of a failure of the fetch, of the archive reader or of the pinned-bundle check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BundleSourceFailureCode {
    /// A code of the archive reader or of the pinned-bundle check.
    Bundle(BundleFailureCode),
    /// `bundle.package-missing`.
    PackageMissing,
    /// `bundle.package-version`.
    PackageVersion,
    /// `bundle.release-url`.
    ReleaseUrl,
    /// `bundle.release-failed`.
    ReleaseFailed,
    /// `bundle.git-url`.
    GitUrl,
    /// `bundle.git-tag`.
    GitTag,
    /// `bundle.git-directory`.
    GitDirectory,
    /// `bundle.git-failed`.
    GitFailed,
    /// `bundle.source-local`.
    SourceLocal,
    /// `bundle.cache-invalid`.
    CacheInvalid,
    /// `bundle.maven-jvm-only`.
    MavenJvmOnly,
    /// `bundle.import-api-missing`.
    ImportApiMissing,
}

impl BundleSourceFailureCode {
    /// The code as the failure files write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bundle(code) => code.as_str(),
            Self::PackageMissing => "bundle.package-missing",
            Self::PackageVersion => "bundle.package-version",
            Self::ReleaseUrl => "bundle.release-url",
            Self::ReleaseFailed => "bundle.release-failed",
            Self::GitUrl => "bundle.git-url",
            Self::GitTag => "bundle.git-tag",
            Self::GitDirectory => "bundle.git-directory",
            Self::GitFailed => "bundle.git-failed",
            Self::SourceLocal => "bundle.source-local",
            Self::CacheInvalid => "bundle.cache-invalid",
            Self::MavenJvmOnly => "bundle.maven-jvm-only",
            Self::ImportApiMissing => "bundle.import-api-missing",
        }
    }
}

/// Why a bundle source cannot be fetched or verified, with the fix.
#[derive(Debug, Clone, PartialEq)]
pub struct BundleSourceFailure {
    /// The `code` member.
    pub code: BundleSourceFailureCode,
    /// The `message` member.
    pub message: String,
    /// The `fix` member.
    pub fix: String,
    /// The path the failure is about.
    pub file: Option<String>,
    /// What was expected, when two values differ.
    pub expected: Option<String>,
    /// What was found, when two values differ.
    pub actual: Option<String>,
}

impl BundleSourceFailure {
    /// A failure with no file and no pair of values.
    #[must_use]
    pub fn new(code: BundleSourceFailureCode, message: String, fix: &str) -> Self {
        Self {
            code,
            message,
            fix: fix.to_owned(),
            file: None,
            expected: None,
            actual: None,
        }
    }

    /// The same failure, about `file`.
    #[must_use]
    pub fn about(mut self, file: &str) -> Self {
        self.file = Some(file.to_owned());

        self
    }

    /// The same failure, with the value expected.
    #[must_use]
    pub fn expecting(mut self, expected: String) -> Self {
        self.expected = Some(expected);

        self
    }

    /// The same failure, with the value found.
    #[must_use]
    pub fn finding(mut self, actual: String) -> Self {
        self.actual = Some(actual);

        self
    }
}

impl From<BundleFailure> for BundleSourceFailure {
    fn from(failure: BundleFailure) -> Self {
        Self {
            code: BundleSourceFailureCode::Bundle(failure.code),
            message: failure.message,
            fix: failure.fix,
            file: failure.file,
            expected: failure.expected,
            actual: failure.actual,
        }
    }
}

/// The source as the config writes it, for messages.
#[must_use]
pub fn bundle_source_text(source: &BundleSource) -> String {
    match &source.form {
        BundleSourceForm::Package(package) => {
            format!(
                "package {} version {}",
                quote_text(&package.package),
                diagnostic_inert(&package.version)
            )
        }
        BundleSourceForm::Release(release) => {
            format!("release '{}'", printable_url(&release.url))
        }
        BundleSourceForm::Maven(coordinate) => {
            format!("Maven artefact {}", quote_text(coordinate))
        }
        BundleSourceForm::Git(git) => {
            let directory = git
                .directory
                .as_ref()
                .map_or_else(String::new, |directory| {
                    format!(", directory {}", quote_text(directory))
                });

            format!(
                "git '{}' tag {}{directory}",
                printable_url(&git.url),
                quote_text(&git.tag)
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use seampact_bundle_source::{GitBundleSource, PackageBundleSource, ReleaseBundleSource};
    use seampact_diagnostics::diagnostic_inert;

    use super::*;

    #[test]
    fn a_source_text_for_messages_never_holds_the_token_of_its_url() {
        let token_url = "https://x-access-token:SECRET@github.com/o/r.git?t=S2";
        let git = BundleSource {
            form: BundleSourceForm::Git(GitBundleSource {
                url: token_url.to_owned(),
                tag: "v1".to_owned(),
                directory: None,
            }),
            integrity: None,
        };
        let release = BundleSource {
            form: BundleSourceForm::Release(ReleaseBundleSource {
                url: token_url.to_owned(),
            }),
            integrity: None,
        };

        assert_eq!(
            bundle_source_text(&git),
            "git 'https://github.com/o/r.git' tag 'v1'"
        );
        assert_eq!(
            bundle_source_text(&release),
            "release 'https://github.com/o/r.git'"
        );
    }

    #[test]
    fn authored_parts_of_a_source_text_are_inert() {
        let hostile = "a\u{1b}[2J\u{202e}b";
        let sources = [
            BundleSourceForm::Package(PackageBundleSource {
                package: hostile.to_owned(),
                version: hostile.to_owned(),
            }),
            BundleSourceForm::Maven(hostile.to_owned()),
            BundleSourceForm::Git(GitBundleSource {
                url: "https://github.com/o/r.git".to_owned(),
                tag: hostile.to_owned(),
                directory: Some(hostile.to_owned()),
            }),
        ];

        for form in sources {
            let text = bundle_source_text(&BundleSource {
                form,
                integrity: None,
            });

            assert_eq!(text, diagnostic_inert(&text), "source text {text:?}");
        }
    }
}
