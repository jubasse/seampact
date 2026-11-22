//! The two kinds of `seampact.config.yaml`.

/// Which config a file is read as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ConfigKind {
    /// One app's config.
    App,
    /// A monorepo root's config.
    Root,
}

impl ConfigKind {
    /// The name the problems use: `app config` or `root config`.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::App => "app config",
            Self::Root => "root config",
        }
    }

    /// The name with its indefinite article.
    pub(crate) fn articled(self) -> &'static str {
        match self {
            Self::App => "an app config",
            Self::Root => "a root config",
        }
    }
}
