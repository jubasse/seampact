//! Where an imported bundle comes from, as a workspace or a config names it.

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
