//! The root config that lists an app: the nearest `seampact.config.yaml` above it that holds `apps`.

use camino::Utf8Path;

use crate::config_file::{ParseConfigOutcome, file_size, parse_config_file};
use crate::config_kind::ConfigKind;
use crate::config_names::{APP_CONFIG_FILE_NAME, ROOT_CONFIG_MARKER_KEY};
use crate::json_access::record;
use crate::node_path::{directory_of, joined_path, relative_path};
use crate::read_root_config::{LoadedRootConfig, ReadRootConfigOutcome, read_root_config};
use crate::{CliConfigError, CliProblem};

const REPOSITORY_MARKER: &str = ".git";

/// What the search above an app found.
#[derive(Debug, Clone, PartialEq)]
pub enum RootDiscovery {
    /// No root config applies.
    None,
    /// A root config; `listed` says whether its `apps` lists the app.
    Found {
        /// The root config.
        root: Box<LoadedRootConfig>,
        /// Whether the root's `apps` lists the app.
        listed: bool,
    },
    /// The root config is refused.
    Refused(Vec<CliProblem>),
}

/// Looks for the root config of the app whose config is `app_file`, named `app_display_name` in problems.
///
/// Stops at a directory holding `.git`, or at the file system root; a root that does not list
/// the app is kept as the fallback while the search goes on.
///
/// # Errors
///
/// [`CliConfigError`] when a candidate config file cannot be read.
pub fn find_root_config(
    app_file: &Utf8Path,
    app_display_name: &str,
) -> Result<RootDiscovery, CliConfigError> {
    let app_directory = directory_of(app_file);
    let mut nearest_unlisting: Option<RootDiscovery> = None;

    if app_directory.join(REPOSITORY_MARKER).exists() {
        return Ok(RootDiscovery::None);
    }

    let mut directory = directory_of(&app_directory);

    loop {
        let candidate = directory.join(APP_CONFIG_FILE_NAME);
        let display_name = joined_path(
            &directory_of(Utf8Path::new(app_display_name)),
            &relative_path(&app_directory, &candidate),
        );
        let found = root_config_at(&candidate, display_name.as_str(), &app_directory)?;

        if let Some(found) = found {
            let is_final = match &found {
                RootDiscovery::Found { listed, .. } => *listed,
                RootDiscovery::Refused(_) | RootDiscovery::None => true,
            };

            if is_final {
                return Ok(found);
            }

            nearest_unlisting.get_or_insert(found);
        }

        if directory.join(REPOSITORY_MARKER).exists() || directory_of(&directory) == directory {
            return Ok(nearest_unlisting.unwrap_or(RootDiscovery::None));
        }

        directory = directory_of(&directory);
    }
}

// A root config at `file`, or `None` for no file or a file that is not a root config; never `RootDiscovery::None`.
fn root_config_at(
    file: &Utf8Path,
    display_name: &str,
    app_directory: &Utf8Path,
) -> Result<Option<RootDiscovery>, CliConfigError> {
    if file_size(file)?.is_none() {
        return Ok(None);
    }

    let value = match parse_config_file(file, display_name, ConfigKind::Root)? {
        ParseConfigOutcome::Refused(problems) => return Ok(Some(RootDiscovery::Refused(problems))),
        ParseConfigOutcome::Parsed { value, .. } => value,
    };

    if !record(Some(&value)).is_some_and(|object| object.contains_key(ROOT_CONFIG_MARKER_KEY)) {
        return Ok(None);
    }

    match read_root_config(file, display_name)? {
        ReadRootConfigOutcome::Refused(problems) => Ok(Some(RootDiscovery::Refused(problems))),
        ReadRootConfigOutcome::Read(root) => {
            let listed = root.apps.iter().any(|app| app.directory == app_directory);

            Ok(Some(RootDiscovery::Found {
                root: Box::new(root),
                listed,
            }))
        }
    }
}
