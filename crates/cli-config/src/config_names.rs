//! The file and key names the config reading shares.

/// The file name of an app or a root config.
pub(crate) const APP_CONFIG_FILE_NAME: &str = "seampact.config.yaml";

/// The key only a root config holds: its presence tells a root config from an app's.
pub(crate) const ROOT_CONFIG_MARKER_KEY: &str = "apps";

/// The directory, below the app's, generated files go to when `outDir` is not set.
pub(crate) const DEFAULT_OUT_DIR: &str = "__generated__";
