//! The config of one run: an app config or a root config.

use camino::Utf8Path;
use seampact_json::object_of;

use crate::config_file::{ParseConfigOutcome, parse_config_file};
use crate::config_kind::ConfigKind;
use crate::config_names::ROOT_CONFIG_MARKER_KEY;
use crate::read_app_config::{LoadedAppConfig, ReadAppConfigOutcome, read_app_config};
use crate::read_workspace_configs::{
    LoadedWorkspace, ReadWorkspaceOutcome, read_workspace_configs,
};
use crate::{CliConfigError, CliProblem};

const APP_DIRECTORY_ROOT_CODE: &str = "cli.app-directory.root";
const APP_DIRECTORY_ROOT_FIX: &str =
    "Pass a root config with `--config` alone, from the root's directory.";

/// The config a command runs on: one app, or a root and its apps.
#[derive(Debug, Clone, PartialEq)]
pub enum RunConfig {
    /// A file without `apps`: one app's config.
    App(Box<LoadedAppConfig>),
    /// A file holding `apps`: a monorepo root and each app it lists.
    Root(Box<LoadedWorkspace>),
}

/// The run read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadRunConfigOutcome {
    /// The `run` member.
    Read(RunConfig),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the config a command runs on from `file`; `text_file` holds its text when it differs.
///
/// A file holding `apps` is a root config, any other an app config; a root config read through
/// `text_file` (`--app-directory`) is refused.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a file cannot be read, [`CliConfigError::Internal`] for a bug.
pub fn read_run_config(
    file: &Utf8Path,
    display_name: &str,
    text_file: Option<&Utf8Path>,
) -> Result<ReadRunConfigOutcome, CliConfigError> {
    let value = match parse_config_file(text_file.unwrap_or(file), display_name, ConfigKind::App)? {
        ParseConfigOutcome::Refused(problems) => {
            return Ok(ReadRunConfigOutcome::Refused(problems));
        }
        ParseConfigOutcome::Parsed { value, .. } => value,
    };
    let is_root =
        object_of(Some(&value)).is_some_and(|object| object.contains_key(ROOT_CONFIG_MARKER_KEY));

    if is_root && text_file.is_some() {
        return Ok(ReadRunConfigOutcome::Refused(vec![CliProblem::unlocated(
            APP_DIRECTORY_ROOT_CODE,
            format!(
                "{display_name} is a monorepo root config, and `--app-directory` reads one app's config."
            ),
            APP_DIRECTORY_ROOT_FIX,
        )]));
    }

    if is_root {
        return Ok(match read_workspace_configs(file, display_name)? {
            ReadWorkspaceOutcome::Refused(problems) => ReadRunConfigOutcome::Refused(problems),
            ReadWorkspaceOutcome::Read(workspace) => {
                ReadRunConfigOutcome::Read(RunConfig::Root(Box::new(workspace)))
            }
        });
    }

    Ok(match read_app_config(file, display_name, text_file)? {
        ReadAppConfigOutcome::Refused(problems) => ReadRunConfigOutcome::Refused(problems),
        ReadAppConfigOutcome::Read(config) => {
            ReadRunConfigOutcome::Read(RunConfig::App(Box::new(config)))
        }
    })
}
