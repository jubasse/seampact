//! The package manager of a project, found by its lockfile, and the install command it takes.

use camino::Utf8Path;

use seampact_json::{object_of, text_of};

use crate::CliConfigError;
use crate::package_json::{PackageJsonRead, read_package_json};
use seampact_paths::node_path;

/// A package manager a lockfile names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PackageManager {
    /// `pnpm-lock.yaml`.
    Pnpm,
    /// `package-lock.json`, and the default without a lockfile.
    Npm,
    /// `yarn.lock`.
    Yarn,
    /// `bun.lock` or `bun.lockb`.
    Bun,
}

/// Where an installed package goes in `package.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DependencyKind {
    /// `devDependencies`.
    Dev,
    /// `dependencies`.
    Runtime,
}

impl PackageManager {
    const fn name(self) -> &'static str {
        match self {
            Self::Pnpm => "pnpm",
            Self::Npm => "npm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }

    const fn install_prefix(self, kind: DependencyKind) -> &'static str {
        match (kind, self) {
            (DependencyKind::Dev, Self::Pnpm) => "pnpm add -D",
            (DependencyKind::Dev, Self::Npm) => "npm install -D",
            (DependencyKind::Dev, Self::Yarn) => "yarn add -D",
            (DependencyKind::Dev, Self::Bun) => "bun add -d",
            (DependencyKind::Runtime, Self::Pnpm) => "pnpm add",
            (DependencyKind::Runtime, Self::Npm) => "npm install",
            (DependencyKind::Runtime, Self::Yarn) => "yarn add",
            (DependencyKind::Runtime, Self::Bun) => "bun add",
        }
    }
}

/// The lockfile each package manager writes, checked in this order in each directory.
const LOCKFILES: [(&str, PackageManager); 5] = [
    ("pnpm-lock.yaml", PackageManager::Pnpm),
    ("yarn.lock", PackageManager::Yarn),
    ("bun.lock", PackageManager::Bun),
    ("bun.lockb", PackageManager::Bun),
    ("package-lock.json", PackageManager::Npm),
];

/// A `package.json` on the way that is not JSON, or a failure to read one.
enum PackageManagerFailure {
    /// `JSON.parse` threw a `SyntaxError` with this message.
    Syntax {
        message: String,
    },
    Other(CliConfigError),
}

impl From<CliConfigError> for PackageManagerFailure {
    fn from(error: CliConfigError) -> Self {
        Self::Other(error)
    }
}

impl PackageManagerFailure {
    /// The failure as the TypeScript lets it escape: a `SyntaxError` is a crash there.
    fn into_error(self, directory: &Utf8Path) -> CliConfigError {
        match self {
            Self::Syntax { message } => CliConfigError::Io {
                path: directory.to_string(),
                message: format!("a package.json above is not valid JSON ({message})"),
            },
            Self::Other(error) => error,
        }
    }
}

/// The command that installs `package_name` in the project of `directory`.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a `package.json` on the way cannot be read or is not JSON.
pub fn install_command(
    directory: &Utf8Path,
    package_name: &str,
    kind: DependencyKind,
) -> Result<String, CliConfigError> {
    install_command_or_failure(directory, package_name, kind)
        .map_err(|failure| failure.into_error(directory))
}

fn install_command_or_failure(
    directory: &Utf8Path,
    package_name: &str,
    kind: DependencyKind,
) -> Result<String, PackageManagerFailure> {
    let manager = package_manager_from(directory)?;

    Ok(format!("{} {package_name}", manager.install_prefix(kind)))
}

/// The fix of a problem whose package is missing: the install command, or a generic sentence when
/// a `package.json` on the way cannot be parsed.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a `package.json` on the way cannot be read.
pub fn install_fix(
    directory: &Utf8Path,
    package_name: &str,
    kind: DependencyKind,
) -> Result<String, CliConfigError> {
    match install_command_or_failure(directory, package_name, kind) {
        Ok(command) => Ok(format!("Install it: `{command}`.")),
        Err(PackageManagerFailure::Syntax { message }) => Ok(format!(
            "Install it with your package manager; a `package.json` above {directory} is not valid JSON ({message})."
        )),
        Err(PackageManagerFailure::Other(error)) => Err(error),
    }
}

/// The package manager of the nearest directory from `directory` up that holds a lockfile or a
/// `packageManager` key; npm when none does.
///
/// # Errors
///
/// [`CliConfigError::Io`] when a `package.json` on the way cannot be read or is not JSON.
pub fn find_package_manager(directory: &Utf8Path) -> Result<PackageManager, CliConfigError> {
    package_manager_from(directory).map_err(|failure| failure.into_error(directory))
}

fn package_manager_from(directory: &Utf8Path) -> Result<PackageManager, PackageManagerFailure> {
    let mut current = directory.to_path_buf();

    loop {
        if let Some(found) = package_manager_in(&current)? {
            return Ok(found);
        }

        let parent = node_path::dirname(&current);

        if parent == current {
            return Ok(PackageManager::Npm);
        }

        current = parent;
    }
}

fn package_manager_in(
    directory: &Utf8Path,
) -> Result<Option<PackageManager>, PackageManagerFailure> {
    let lockfile = LOCKFILES
        .iter()
        .find(|(file, _)| node_path::join(directory, Utf8Path::new(file)).exists());

    if let Some((_, manager)) = lockfile {
        return Ok(Some(*manager));
    }

    declared_package_manager(&node_path::join(directory, Utf8Path::new("package.json")))
}

fn declared_package_manager(
    package_json_file: &Utf8Path,
) -> Result<Option<PackageManager>, PackageManagerFailure> {
    if !package_json_file.exists() {
        return Ok(None);
    }

    let package_json = match read_package_json(package_json_file)? {
        PackageJsonRead::Parsed(value) => value,
        PackageJsonRead::Syntax { message } => {
            return Err(PackageManagerFailure::Syntax { message });
        }
    };
    let declared = object_of(Some(&package_json)).and_then(|object| object.get("packageManager"));
    let Some(declared) = text_of(declared) else {
        return Ok(None);
    };
    let name = declared.split('@').next().unwrap_or_default();

    Ok(LOCKFILES
        .iter()
        .map(|(_, manager)| *manager)
        .find(|manager| manager.name() == name))
}
