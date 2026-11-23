//! Where an imported bundle comes from, as a workspace or a config names it.

use seampact_json::JsonValue;
use serde::Deserialize;

/// An npm package installed in the project, resolved from the config file's directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageBundleSource {
    /// The package name.
    pub package: String,
    /// The version the installed package must be at.
    pub version: String,
}

/// A bundle tarball served over HTTPS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseBundleSource {
    /// The tarball's URL, as written.
    pub url: String,
}

/// A bundle directory in a git repository at a tag; the repository root when `directory` is absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitBundleSource {
    /// The repository's URL or path, as written.
    pub url: String,
    /// The tag the bundle was committed under.
    pub tag: String,
    /// The bundle directory, relative to the repository root.
    pub directory: Option<String>,
}

/// How a bundle is reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleSourceForm {
    /// An installed npm package.
    Package(PackageBundleSource),
    /// A tarball over HTTPS.
    Release(ReleaseBundleSource),
    /// A git tag.
    Git(GitBundleSource),
    /// A Maven artefact, `groupId:artifactId:version`, which only a JVM build resolves.
    Maven(String),
}

/// Where an imported bundle comes from, and the integrity it is pinned to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleSource {
    /// The channel and its coordinates.
    pub form: BundleSourceForm,
    /// The pinned integrity; absent until the user copies the value the check prints.
    pub integrity: Option<String>,
}

/// The members a source entry writes; the schemas allow one form per entry.
#[derive(Debug, Deserialize)]
struct WrittenSource {
    integrity: Option<String>,
    path: Option<serde_json::Value>,
    maven: Option<String>,
    package: Option<String>,
    version: Option<String>,
    release: Option<WrittenRelease>,
    git: Option<WrittenGit>,
}

#[derive(Debug, Deserialize)]
struct WrittenRelease {
    url: String,
}

#[derive(Debug, Deserialize)]
struct WrittenGit {
    url: String,
    tag: String,
    directory: Option<String>,
}

/// The bundle source a workspace import or a config entry writes, or `None` when the entry is a
/// `path` source, names no form or several, or a form lacks a member it needs: the schemas
/// refuse each of those, and the compilation reports it.
#[must_use]
pub fn written_bundle_source(entry: &JsonValue) -> Option<BundleSource> {
    let written: WrittenSource = serde_json::to_value(entry)
        .and_then(serde_json::from_value)
        .ok()?;
    let forms = [
        written.path.is_some(),
        written.maven.is_some(),
        written.package.is_some(),
        written.release.is_some(),
        written.git.is_some(),
    ];

    if forms.iter().filter(|present| **present).count() != 1 || written.path.is_some() {
        return None;
    }

    let form = if let Some(coordinate) = written.maven {
        BundleSourceForm::Maven(coordinate)
    } else if let (Some(package), Some(version)) = (written.package, written.version) {
        BundleSourceForm::Package(PackageBundleSource { package, version })
    } else if let Some(release) = written.release {
        BundleSourceForm::Release(ReleaseBundleSource { url: release.url })
    } else {
        let git = written.git?;

        BundleSourceForm::Git(GitBundleSource {
            url: git.url,
            tag: git.tag,
            directory: git.directory,
        })
    };

    Some(BundleSource {
        form,
        integrity: written.integrity,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(text: &str) -> Option<BundleSource> {
        let value: serde_json::Value = serde_json::from_str(text).unwrap();

        written_bundle_source(&JsonValue::try_from(value).unwrap())
    }

    #[test]
    fn an_entry_of_one_form_is_read_with_its_integrity() {
        let source =
            written(r#"{"api":"a","package":"p","version":"1.0.0","integrity":"sha256-x"}"#);

        assert_eq!(
            source,
            Some(BundleSource {
                form: BundleSourceForm::Package(PackageBundleSource {
                    package: "p".to_owned(),
                    version: "1.0.0".to_owned(),
                }),
                integrity: Some("sha256-x".to_owned()),
            })
        );
    }

    #[test]
    fn a_path_source_no_form_two_forms_or_a_half_form_is_not_a_bundle_source() {
        for text in [
            r#"{"path":"./x"}"#,
            r"{}",
            r#"{"package":"p","version":"1","release":{"url":"u"}}"#,
            r#"{"package":"p"}"#,
            r#"{"git":{"url":"u"}}"#,
        ] {
            assert_eq!(written(text), None, "entry {text}");
        }
    }
}
