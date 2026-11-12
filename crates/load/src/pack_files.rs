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

#[cfg(test)]
mod tests {
    use regress::Regex;

    use super::*;

    const PACK_FILE_PATTERN: &str = r"^((?:\.\.\/)*node_modules\/(?:@[^/]+\/)?[^/]+)\/(.+)$";

    const PACK_FILES: &[&str] = &[
        "node_modules/pkg/a.yaml",
        "node_modules/pkg/lib/pack.yaml",
        "../node_modules/@acme/pack-a/lib/pack.yaml",
        "../../../node_modules/@acme/pack-a/package.json",
        "node_modules/@acme/pack-a/x",
        "node_modules/@a/b",
        "node_modules/@/x",
        "node_modules/@/x/y",
        "node_modules/@a//x",
        "node_modules/pkg",
        "node_modules/pkg/",
        "node_modules//x",
        "node_modules/",
        "node_modules",
        "node_modules/pkg/a\nb",
        "node_modules/pkg/a\rb",
        "node_modules/pkg/a\u{2028}",
        "node_modules/pkg/a\u{2029}b",
        "node_modules/pkg\n/a",
        "node_modules/@s\n/n/x",
        "x/node_modules/pkg/a",
        "./node_modules/pkg/a",
        "..//node_modules/pkg/a",
        "..node_modules/pkg/a",
        "../ ../node_modules/pkg/a",
        "node_modulesx/pkg/a",
        "node_modules/é/😀.yaml",
        "node_modules/@é/😀/\u{E000}.yaml",
        "../node_modules/node_modules/pkg/a",
        "node_modules/node_modules/a",
        "",
        "api.yaml",
    ];

    // The patterns the TypeScript matches by; the plain-code split must agree on every input.
    #[test]
    fn the_split_agrees_with_the_ecmascript_pattern() {
        let pattern = Regex::with_flags(PACK_FILE_PATTERN, "u").expect("the pattern compiles");

        for file in PACK_FILES {
            let expected = pattern.find(file).map(|found| {
                let directory = found.group(1).and_then(|range| file.get(range));
                let inside = found.group(2).and_then(|range| file.get(range));

                (directory.unwrap_or_default(), inside.unwrap_or_default())
            });

            assert_eq!(split_pack_file(file), expected, "file {file:?}");
        }
    }

    #[test]
    fn a_pack_file_has_a_package_name_and_a_path_inside() {
        assert_eq!(
            pack_file_parts("../node_modules/@acme/pack-a/lib/pack.yaml"),
            Some(PackFileParts {
                name: "@acme/pack-a",
                inside: "lib/pack.yaml"
            })
        );
        assert_eq!(
            pack_file_parts("node_modules/pkg/a.yaml"),
            Some(PackFileParts {
                name: "pkg",
                inside: "a.yaml"
            })
        );
        assert_eq!(pack_file_parts("api.yaml"), None);
        assert_eq!(pack_file_parts("node_modules/pkg"), None);
    }

    #[test]
    fn the_package_name_is_what_follows_the_last_node_modules() {
        assert_eq!(
            package_name_of("../node_modules/@acme/pack-a"),
            Some("@acme/pack-a")
        );
        assert_eq!(
            package_name_of("node_modules/node_modules/pkg"),
            Some("pkg")
        );
        assert_eq!(package_name_of("node_modules/"), Some(""));
        assert_eq!(package_name_of("elsewhere/pkg"), None);
    }

    #[test]
    fn a_pack_is_vendored_under_its_name_and_version() {
        assert_eq!(
            pack_vendored_directory("@acme/pack-a", "1.2.0"),
            ".packs/@acme/pack-a@1.2.0"
        );
        assert_eq!(
            pack_vendored_file("@acme/pack-a", "1.2.0", "lib/pack.yaml"),
            ".packs/@acme/pack-a@1.2.0/lib/pack.yaml"
        );
    }

    #[test]
    fn a_pack_layer_is_written_pack_colon_name() {
        assert_eq!(
            pack_layer_id_of("@acme/pack-a").to_string(),
            "pack:@acme/pack-a"
        );
        assert_eq!(pack_layer_id_of("").to_string(), "pack:");
    }
}
