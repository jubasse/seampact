//! The installed version of a framework or library package, read from its `package.json` in the
//! `node_modules` directories from a lookup directory up, as Node's resolution searches them.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_json::{object_of, text_of};

use crate::node_path::{directory_of, joined_path};
use crate::package_json::{PackageJsonRead, read_package_json};
use crate::package_manager::{DependencyKind, install_fix};
use crate::{CliConfigError, CliProblem, located_problem};

/// A package found installed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InstalledVersion {
    /// The package name.
    pub package_name: String,
    /// The `version` of its `package.json`.
    pub version: String,
    /// The major of the version; a pre-release counts as its major.
    pub major: u64,
}

/// The installed version, or the problem that refuses it.
#[derive(Debug, Clone, PartialEq)]
pub enum InstalledVersionOutcome {
    /// The package is installed.
    Installed(InstalledVersion),
    /// The package is missing or its `package.json` cannot be read.
    Refused(CliProblem),
}

/// What the generated code imports the package as, which the problems name it by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InstalledPackageRole {
    /// The framework the target generates for.
    Framework,
    /// A library the switched-on artefacts import.
    Library,
    /// The validator library of a link.
    ValidatorLibrary,
}

impl InstalledPackageRole {
    const fn label(self) -> &'static str {
        match self {
            Self::Framework => "framework package",
            Self::Library => "library",
            Self::ValidatorLibrary => "validator library",
        }
    }
}

/// The code of the problem for a package that is not installed in the project.
pub(crate) const FRAMEWORK_MISSING_CODE: &str = "config.matrix.framework-missing";

const NODE_MODULES: &str = "node_modules";

const PNP_FILES: [&str; 2] = [".pnp.cjs", ".pnp.js"];

/// The largest major a JavaScript number holds exactly; a larger one is read as unreadable.
const LARGEST_EXACT_MAJOR: u64 = 9_007_199_254_740_992;

/// What the `package.json` declares, or why it cannot be read.
enum DeclaredMajor {
    Read { version: String, major: u64 },
    Unreadable { reason: String },
}

/// Reads the installed version of `package_name` from `lookup_directory` up; `entry_where` names
/// the entry in a problem.
///
/// A major above 2^53 is refused as unreadable, since a JavaScript number does not hold it.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a `package.json` exists and cannot be read.
pub fn read_installed_version(
    lookup_directory: &Utf8Path,
    package_name: &str,
    role: InstalledPackageRole,
    entry_where: &str,
) -> Result<InstalledVersionOutcome, CliConfigError> {
    let Some(package_json_file) = find_package_json(lookup_directory, package_name) else {
        return Ok(InstalledVersionOutcome::Refused(missing_package_problem(
            lookup_directory,
            package_name,
            role,
            entry_where,
        )?));
    };

    match declared_major(&package_json_file)? {
        DeclaredMajor::Unreadable { reason } => {
            Ok(InstalledVersionOutcome::Refused(located_problem(
                "config.matrix.version-unreadable",
                format!(
                    "The installed {} '{package_name}' has no version the CLI can read: {reason}",
                    role.label()
                ),
                &format!("Reinstall '{package_name}' with your package manager."),
                entry_where.to_owned(),
            )))
        }
        DeclaredMajor::Read { version, major } => {
            Ok(InstalledVersionOutcome::Installed(InstalledVersion {
                package_name: package_name.to_owned(),
                version,
                major,
            }))
        }
    }
}

fn find_package_json(lookup_directory: &Utf8Path, package_name: &str) -> Option<Utf8PathBuf> {
    ancestors_of(lookup_directory)
        .into_iter()
        .filter(|directory| directory.file_name() != Some(NODE_MODULES))
        .map(|directory| {
            let package_directory = joined_path(
                &joined_path(&directory, Utf8Path::new(NODE_MODULES)),
                Utf8Path::new(package_name),
            );

            joined_path(&package_directory, Utf8Path::new("package.json"))
        })
        .find(|file| file.exists())
}

fn missing_package_problem(
    lookup_directory: &Utf8Path,
    package_name: &str,
    role: InstalledPackageRole,
    entry_where: &str,
) -> Result<CliProblem, CliConfigError> {
    let pnp_file = ancestors_of(lookup_directory)
        .into_iter()
        .flat_map(|directory| {
            PNP_FILES
                .iter()
                .map(move |file| joined_path(&directory, Utf8Path::new(file)))
        })
        .find(|file| file.exists());

    if let Some(pnp_file) = pnp_file {
        return Ok(located_problem(
            "config.matrix.pnp-unsupported",
            format!(
                "The project around {lookup_directory} installs its packages with Yarn Plug'n'Play ({pnp_file}), which the CLI cannot read the version of '{package_name}' from."
            ),
            "Set `nodeLinker: node-modules` in the project's `.yarnrc.yml`, then run `yarn install`.",
            entry_where.to_owned(),
        ));
    }

    Ok(located_problem(
        FRAMEWORK_MISSING_CODE,
        format!(
            "The {} '{package_name}' is not installed in the project of the entry's output directory ({lookup_directory}), so its version cannot be checked against the compatibility matrix; the generated code imports it.",
            role.label()
        ),
        &install_fix(lookup_directory, package_name, DependencyKind::Runtime)?,
        entry_where.to_owned(),
    ))
}

/// The directory and each parent up to the root.
fn ancestors_of(directory: &Utf8Path) -> Vec<Utf8PathBuf> {
    let mut ancestors = vec![directory.to_path_buf()];

    loop {
        let parent = directory_of(ancestors.last().map_or(directory, Utf8PathBuf::as_path));

        if ancestors.last() == Some(&parent) {
            return ancestors;
        }

        ancestors.push(parent);
    }
}

fn declared_major(package_json_file: &Utf8Path) -> Result<DeclaredMajor, CliConfigError> {
    let value = match read_package_json(package_json_file)? {
        PackageJsonRead::Parsed(value) => value,
        PackageJsonRead::Syntax { message } => {
            return Ok(DeclaredMajor::Unreadable {
                reason: format!("{package_json_file} is not valid JSON ({message})."),
            });
        }
    };
    let version = text_of(object_of(Some(&value)).and_then(|object| object.get("version")));
    let major = version.and_then(major_of);

    match (version, major) {
        (Some(version), Some(major)) => Ok(DeclaredMajor::Read {
            version: version.to_owned(),
            major,
        }),
        _ => Ok(DeclaredMajor::Unreadable {
            reason: format!(
                "{package_json_file} declares no `version` of the form <major>.<minor>.<patch>."
            ),
        }),
    }
}

/// The major of `^v?(0|[1-9][0-9]*)\.`, `None` when the version does not start so.
fn major_of(version: &str) -> Option<u64> {
    let digits_start = version.strip_prefix('v').unwrap_or(version);
    let digit_count = digits_start
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(digits_start.len());
    let (digits, after) = digits_start.split_at_checked(digit_count)?;

    if !after.starts_with('.') || digits.is_empty() || (digits.starts_with('0') && digits != "0") {
        return None;
    }

    digits
        .parse::<u64>()
        .ok()
        .filter(|major| *major <= LARGEST_EXACT_MAJOR)
}
