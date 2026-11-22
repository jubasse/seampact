//! The bundle source a config writes, read into the type the bundle fetch takes.

use seampact_bundle::{
    BundleSource, BundleSourceForm, GitBundleSource, PackageBundleSource, ReleaseBundleSource,
};
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use serde::Deserialize;

/// The members a source entry writes; the config schema allows one form per entry.
#[derive(Debug, Deserialize)]
struct WrittenSource {
    integrity: Option<String>,
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

/// The bundle source of a config entry that is not a `path` source.
///
/// # Errors
///
/// [`InternalError`] when the entry names no source form the config schema allows.
pub fn bundle_source_of(entry: &JsonValue) -> Result<BundleSource, InternalError> {
    let written: WrittenSource = serde_json::to_value(entry)
        .and_then(serde_json::from_value)
        .map_err(|error| {
            InternalError::new(format!("a bundle source passed the schema: {error}"))
        })?;
    let WrittenSource {
        integrity,
        maven,
        package,
        version,
        release,
        git,
    } = written;

    let form = if let Some(coordinate) = maven {
        BundleSourceForm::Maven(coordinate)
    } else if let (Some(package), Some(version)) = (package, version) {
        BundleSourceForm::Package(PackageBundleSource { package, version })
    } else if let Some(release) = release {
        BundleSourceForm::Release(ReleaseBundleSource { url: release.url })
    } else if let Some(git) = git {
        BundleSourceForm::Git(GitBundleSource {
            url: git.url,
            tag: git.tag,
            directory: git.directory,
        })
    } else {
        return Err(InternalError::new(
            "a bundle source with no package, release, git or maven form passed the schema",
        ));
    };

    Ok(BundleSource { form, integrity })
}
