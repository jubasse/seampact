//! Lexical path arithmetic as Node's `path` module does it: no file system, no symbolic links.

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};

const CURRENT_DIRECTORY: &str = ".";

/// `path.resolve(base, segment)` for an absolute `base`: `segment` joined and normalised.
#[must_use]
pub fn resolved_path(base: &Utf8Path, segment: &str) -> Utf8PathBuf {
    normalized_path(&base.join(segment))
}

/// `path.join(base, segment)`: joined and normalised; a relative result keeps its leading `..`.
pub(crate) fn joined_path(base: &Utf8Path, segment: &Utf8Path) -> Utf8PathBuf {
    let mut joined = base.to_path_buf();

    joined.push(segment.as_str().trim_start_matches('/'));

    normalized_path(&joined)
}

/// `path.dirname(path)`: the parent, the root for the root, `.` for a bare name.
pub(crate) fn directory_of(path: &Utf8Path) -> Utf8PathBuf {
    match path.parent() {
        None => path.to_path_buf(),
        Some(parent) if parent.as_str().is_empty() => Utf8PathBuf::from(CURRENT_DIRECTORY),
        Some(parent) => parent.to_path_buf(),
    }
}

/// `path.relative(from, to)` for two normalised paths of one kind.
pub(crate) fn relative_path(from: &Utf8Path, to: &Utf8Path) -> Utf8PathBuf {
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

fn normalized_path(path: &Utf8Path) -> Utf8PathBuf {
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

    kept.iter().map(camino::Utf8Component::as_str).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolving_drops_dots_and_stops_at_the_root() {
        let resolved = resolved_path(Utf8Path::new("/a/b"), "../../../c/./d");

        assert_eq!(resolved, Utf8PathBuf::from("/c/d"));
    }

    #[test]
    fn an_absolute_segment_replaces_the_base() {
        assert_eq!(
            resolved_path(Utf8Path::new("/a/b"), "/x/y"),
            Utf8PathBuf::from("/x/y")
        );
    }

    #[test]
    fn the_relative_path_to_an_ancestor_file_climbs_and_joins_to_the_display_name() {
        let relative = relative_path(
            Utf8Path::new("/r/apps/web"),
            Utf8Path::new("/r/seampact.config.yaml"),
        );
        let display = joined_path(
            &directory_of(Utf8Path::new("apps/web/seampact.config.yaml")),
            &relative,
        );

        assert_eq!(relative, Utf8PathBuf::from("../../seampact.config.yaml"));
        assert_eq!(display, Utf8PathBuf::from("seampact.config.yaml"));
    }

    #[test]
    fn the_directory_of_the_root_is_the_root_and_of_a_bare_name_is_a_dot() {
        assert_eq!(directory_of(Utf8Path::new("/")), Utf8PathBuf::from("/"));
        assert_eq!(
            directory_of(Utf8Path::new("a.yaml")),
            Utf8PathBuf::from(".")
        );
    }
}
