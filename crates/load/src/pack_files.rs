//! A file of a package resolved from a `node_modules` at or above the workspace root (the loader's
//! pack walk): the package directory, then the path inside the package.

use seampact_authoring::ApiLayer;
use seampact_ir::PackName;

/// The bundle's packs directory below its sources directory (`sources/.packs`): `.packs`.
const PACKS_DIRECTORY_IN_SOURCES: &str = ".packs";

/// The directory every package sits in.
const NODE_MODULES_DIRECTORY: &str = "node_modules";

/// The directory that holds a pack's files wherever the package manager installed it:
/// `.packs/<name>@<version>`.
#[must_use]
pub fn pack_vendored_directory(name: &str, version: &str) -> String {
    format!("{PACKS_DIRECTORY_IN_SOURCES}/{name}@{version}")
}

/// The package directory and the path inside it of `file`, or `None` for a file in no pack package.
///
/// A package directory is `node_modules/<name>` or `node_modules/@<scope>/<name>`, behind any
/// number of `../`; the path inside is not empty and has no line terminator.
#[must_use]
pub fn split_pack_file(file: &str) -> Option<(&str, &str)> {
    let mut rest = file;

    while let Some(next) = rest.strip_prefix("../") {
        rest = next;
    }

    let after_modules = rest
        .strip_prefix(NODE_MODULES_DIRECTORY)?
        .strip_prefix('/')?;
    let packages_start = file.len() - after_modules.len();

    // A scoped name first; when nothing follows it, the scope alone is the package, as the
    // pattern `^((?:\.\./)*node_modules/(?:@[^/]+/)?[^/]+)/(.+)$` backtracks to.
    scoped_package_split(file, packages_start).or_else(|| plain_package_split(file, packages_start))
}

fn scoped_package_split(file: &str, packages_start: usize) -> Option<(&str, &str)> {
    let after_at = file.get(packages_start..)?.strip_prefix('@')?;
    let scope_length = after_at.find('/')?;

    if scope_length == 0 {
        return None;
    }

    let name_start = packages_start + '@'.len_utf8() + scope_length + '/'.len_utf8();
    let name_length = file.get(name_start..)?.find('/')?;

    if name_length == 0 {
        return None;
    }

    split_inside(file, name_start + name_length)
}

fn plain_package_split(file: &str, packages_start: usize) -> Option<(&str, &str)> {
    let name_length = file.get(packages_start..)?.find('/')?;

    if name_length == 0 {
        return None;
    }

    split_inside(file, packages_start + name_length)
}

/// `file` cut at the `/` at `directory_end`, when what follows is not empty and holds no line
/// terminator (`.` matches none).
fn split_inside(file: &str, directory_end: usize) -> Option<(&str, &str)> {
    let directory = file.get(..directory_end)?;
    let inside = file.get(directory_end + '/'.len_utf8()..)?;

    if inside.is_empty() || inside.contains(is_line_terminator) {
        return None;
    }

    Some((directory, inside))
}

fn is_line_terminator(character: char) -> bool {
    matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// The package name and the path inside the package of a pack file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackFileParts<'file> {
    /// The package name (`@acme/pack-a`).
    pub name: &'file str,
    /// The path inside the package.
    pub inside: &'file str,
}

/// The package name and the path inside the package of a pack file, or `None` for a file in no
/// pack package.
#[must_use]
pub fn pack_file_parts(file: &str) -> Option<PackFileParts<'_>> {
    let (package_directory, inside) = split_pack_file(file)?;

    Some(PackFileParts {
        name: package_name_of(package_directory)?,
        inside,
    })
}

/// The package name of a pack package directory (`../node_modules/@acme/pack-a` gives
/// `@acme/pack-a`); `None` for a directory with no `node_modules/` in it.
#[must_use]
pub fn package_name_of(package_directory: &str) -> Option<&str> {
    let (_, name) = package_directory.rsplit_once("node_modules/")?;

    Some(name)
}

/// A pack file as the bundle vendors it and the side table names it:
/// `.packs/<name>@<version>/<inside>`.
#[must_use]
pub fn pack_vendored_file(name: &str, version: &str, inside: &str) -> String {
    format!("{}/{inside}", pack_vendored_directory(name, version))
}

/// A pack's layer, `pack:<name>`.
#[must_use]
pub fn pack_layer_id_of(name: &str) -> ApiLayer {
    ApiLayer::Pack(PackName::new(name.to_owned()))
}
