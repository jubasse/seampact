//! The CLI's config reading, ported from `packages/core/cli/src/config`: the app, root, workspace
//! and run configs, each read or refused with [`CliProblem`]s.

mod api_refs;
mod artefact_switches;
mod bundle_source;
mod cli_problem;
mod compatibility_check;
mod config_file;
mod config_kind;
mod config_names;
mod config_position;
mod config_schema;
mod config_value;
mod config_waits;
mod document_plan;
mod error;
mod find_root_config;
mod installed_version;
mod key_path;
mod key_problem;
mod maven_source;
mod node_path;
mod not_ported;
mod package_manager;
mod path_containment;
mod read_app_config;
mod read_root_config;
mod read_run_config;
mod read_workspace_configs;
mod resolved_source;
mod schema_failure;
mod schema_order;
mod schema_problems;
mod symbolic_link;

use seampact_diagnostics::RuleId;

pub use api_refs::{ApiRef, api_refs_of, parse_api_ref};
pub use bundle_source::bundle_source_of;
pub use cli_problem::CliProblem;
pub use compatibility_check::{CompatibilityOutcome, check_app_compatibility};
pub use document_plan::open_api_api_names;
pub use error::CliConfigError;
pub use find_root_config::{RootDiscovery, find_root_config};
pub use installed_version::{
    InstalledPackageRole, InstalledVersion, InstalledVersionOutcome, read_installed_version,
};
pub use node_path::{directory_of, relative_path, resolved_path};
pub use package_manager::{
    DependencyKind, PackageManager, find_package_manager, install_command, install_fix,
};
pub use path_containment::is_strictly_inside;
pub use read_app_config::{
    AppConfigEntry, LoadedAppConfig, ReadAppConfigOutcome, read_app_config, read_listed_app_config,
};
pub use read_root_config::{
    LoadedMergedDocument, LoadedRootConfig, ReadRootConfigOutcome, WorkspaceApp, read_root_config,
};
pub use read_run_config::{ReadRunConfigOutcome, RunConfig, read_run_config};
pub use read_workspace_configs::{
    LoadedWorkspace, LoadedWorkspaceApp, ReadWorkspaceOutcome, read_workspace_configs,
};
pub use resolved_source::ResolvedSource;
pub use symbolic_link::{is_path_taken, is_symbolic_link};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
