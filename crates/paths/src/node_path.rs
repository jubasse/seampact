//! Node's `path` arithmetic and package lookup, lexical: no file system, no symbolic links.

use std::{env, io};

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};

const CURRENT_DIRECTORY: &str = ".";
const NODE_MODULES: &str = "node_modules";
const PACKAGE_MANIFEST: &str = "package.json";

/// `path.resolve(base, segment)` for an absolute `base`: `segment` joined and normalised; an
/// absolute `segment` replaces `base`.
#[must_use]
pub fn resolve(base: &Utf8Path, segment: &str) -> Utf8PathBuf {
    normalised(&base.join(segment))
}

/// `path.resolve(path)`: joined to the working directory when relative, then normalised.
///
/// # Errors
///
/// The working directory cannot be read or is not UTF-8.
pub fn resolve_from_working_directory(path: &Utf8Path) -> Result<Utf8PathBuf, io::Error> {
    if path.is_absolute() {
        return Ok(normalised(path));
    }

    let current = Utf8PathBuf::try_from(env::current_dir()?).map_err(io::Error::other)?;

    Ok(resolve(&current, path.as_str()))
}

/// `path.join(base, segment)`: joined and normalised; a relative result keeps its leading `..`.
#[must_use]
pub fn join(base: &Utf8Path, segment: &Utf8Path) -> Utf8PathBuf {
    let mut joined = base.to_path_buf();

    joined.push(segment.as_str().trim_start_matches('/'));

    normalised(&joined)
}

/// `path.dirname(path)`: the parent, the root for the root, `.` for a bare name.
#[must_use]
pub fn dirname(path: &Utf8Path) -> Utf8PathBuf {
    match path.parent() {
        None => path.to_path_buf(),
        Some(parent) if parent.as_str().is_empty() => Utf8PathBuf::from(CURRENT_DIRECTORY),
        Some(parent) => parent.to_path_buf(),
    }
}

/// `path.relative(from, to)` for two normalised paths of one kind.
#[must_use]
pub fn relative(from: &Utf8Path, to: &Utf8Path) -> Utf8PathBuf {
    let from_components: Vec<Utf8Component<'_>> = from.components().collect();
    let to_components: Vec<Utf8Component<'_>> = to.components().collect();
    let shared = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(left, right)| left == right)
        .count();
    let mut relative = Utf8PathBuf::new();

    for _ in from_components.iter().skip(shared) {
        relative.push("..");
    }

    for component in to_components.iter().skip(shared) {
        relative.push(component.as_str());
    }

    relative
}

/// The directory of the package `package_name` as Node's `node_modules` lookup finds it from
/// `start`: the first `<ancestor>/node_modules/<package_name>` holding a `package.json`, an
/// ancestor itself named `node_modules` skipped.
///
/// `package_name` is plain or scoped (`@scope/name`); the caller has checked it.
#[must_use]
pub fn node_modules_lookup(start: &Utf8Path, package_name: &str) -> Option<Utf8PathBuf> {
    normalised(start)
        .ancestors()
        .filter(|directory| directory.file_name() != Some(NODE_MODULES))
        .map(|directory| {
            let mut package_directory = directory.join(NODE_MODULES);

            package_directory.extend(package_name.split('/').filter(|part| !part.is_empty()));

            package_directory
        })
        .find(|package_directory| package_directory.join(PACKAGE_MANIFEST).exists())
}

fn normalised(path: &Utf8Path) -> Utf8PathBuf {
    let mut kept: Vec<Utf8Component<'_>> = Vec::new();

    for component in path.components() {
        match component {
            Utf8Component::CurDir => {}
            Utf8Component::ParentDir => match kept.last() {
                Some(Utf8Component::Normal(_)) => {
                    kept.pop();
                }
                Some(Utf8Component::RootDir | Utf8Component::Prefix(_)) => {}
                Some(Utf8Component::CurDir | Utf8Component::ParentDir) | None => {
                    kept.push(component);
                }
            },
            Utf8Component::Normal(_) | Utf8Component::RootDir | Utf8Component::Prefix(_) => {
                kept.push(component);
            }
        }
    }

    if kept.is_empty() {
        return Utf8PathBuf::from(CURRENT_DIRECTORY);
    }

    kept.iter().map(Utf8Component::as_str).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolving_drops_dots_and_stops_at_the_root() {
        assert_eq!(
            resolve(Utf8Path::new("/a/b"), "../../../c/./d"),
            Utf8PathBuf::from("/c/d")
        );
        assert_eq!(
            resolve(Utf8Path::new("/a/b"), "/x/y"),
            Utf8PathBuf::from("/x/y")
        );
        assert_eq!(resolve(Utf8Path::new("/a"), "."), Utf8PathBuf::from("/a"));
    }

    #[test]
    fn a_relative_path_is_joined_to_the_working_directory() {
        let current = Utf8PathBuf::try_from(env::current_dir().unwrap()).unwrap();

        assert_eq!(
            resolve_from_working_directory(Utf8Path::new("x/../y")).unwrap(),
            current.join("y")
        );
        assert_eq!(
            resolve_from_working_directory(Utf8Path::new("/a/./b/../c//d")).unwrap(),
            Utf8PathBuf::from("/a/c/d")
        );
    }

    #[test]
    fn the_relative_path_to_an_ancestor_file_climbs_and_joins_to_the_display_name() {
        let climbed = relative(
            Utf8Path::new("/r/apps/web"),
            Utf8Path::new("/r/seampact.config.yaml"),
        );
        let display = join(
            &dirname(Utf8Path::new("apps/web/seampact.config.yaml")),
            &climbed,
        );

        assert_eq!(climbed, Utf8PathBuf::from("../../seampact.config.yaml"));
        assert_eq!(display, Utf8PathBuf::from("seampact.config.yaml"));
    }

    #[test]
    fn the_directory_of_the_root_is_the_root_and_of_a_bare_name_is_a_dot() {
        assert_eq!(dirname(Utf8Path::new("/")), Utf8PathBuf::from("/"));
        assert_eq!(dirname(Utf8Path::new("a.yaml")), Utf8PathBuf::from("."));
    }

    #[test]
    fn the_lookup_climbs_and_skips_a_node_modules_directory() {
        let root = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(root.path()).unwrap();
        let package = root.join("node_modules/@acme/notes");
        let nested = root.join("app/node_modules/dep/src");

        std::fs::create_dir_all(&package).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(package.join(PACKAGE_MANIFEST), "{}").unwrap();

        assert_eq!(node_modules_lookup(&nested, "@acme/notes"), Some(package));
        assert_eq!(node_modules_lookup(&nested, "@acme/absent"), None);
    }
}
