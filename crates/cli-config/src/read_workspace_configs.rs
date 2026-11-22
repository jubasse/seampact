//! The root config of a monorepo and the app configs it names.

use camino::Utf8Path;

use crate::config_names::APP_CONFIG_FILE_NAME;
use crate::node_path::{directory_of, joined_path};
use crate::read_app_config::{LoadedAppConfig, ReadAppConfigOutcome, read_listed_app_config};
use crate::read_root_config::{
    LoadedRootConfig, ReadRootConfigOutcome, WorkspaceApp, read_root_config,
};
use crate::{CliConfigError, CliProblem};

/// An app a root lists, with its config read and the root folded in.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedWorkspaceApp {
    /// The app as the root lists it.
    pub app: WorkspaceApp,
    /// The app's config.
    pub config: LoadedAppConfig,
}

/// A root config and every app config it names, read and checked.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedWorkspace {
    /// The root config.
    pub root: LoadedRootConfig,
    /// The listed apps, in the root's order.
    pub apps: Vec<LoadedWorkspaceApp>,
}

/// The workspace read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
#[expect(
    clippy::large_enum_variant,
    reason = "the outcome is returned once and read at once; the design note fixes its shape"
)]
pub enum ReadWorkspaceOutcome {
    /// The `workspace` member.
    Read(LoadedWorkspace),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the root config `root_file` and every app config it names.
///
/// The problems of every app are reported together.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a file cannot be read, [`CliConfigError::Internal`] for a bug.
pub fn read_workspace_configs(
    root_file: &Utf8Path,
    display_name: &str,
) -> Result<ReadWorkspaceOutcome, CliConfigError> {
    let root = match read_root_config(root_file, display_name)? {
        ReadRootConfigOutcome::Refused(problems) => {
            return Ok(ReadWorkspaceOutcome::Refused(problems));
        }
        ReadRootConfigOutcome::Read(root) => root,
    };
    let root_directory = directory_of(Utf8Path::new(display_name));
    let mut apps = Vec::with_capacity(root.apps.len());
    let mut problems = Vec::new();

    for app in &root.apps {
        let app_display_name = joined_path(
            &joined_path(&root_directory, Utf8Path::new(&app.name)),
            Utf8Path::new(APP_CONFIG_FILE_NAME),
        );

        match read_listed_app_config(&app.file, app_display_name.as_str(), &root)? {
            ReadAppConfigOutcome::Refused(refused) => problems.extend(refused),
            ReadAppConfigOutcome::Read(config) => apps.push(LoadedWorkspaceApp {
                app: app.clone(),
                config,
            }),
        }
    }

    if !problems.is_empty() {
        return Ok(ReadWorkspaceOutcome::Refused(problems));
    }

    Ok(ReadWorkspaceOutcome::Read(LoadedWorkspace { root, apps }))
}
