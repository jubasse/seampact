//! A directory made absolute and normalised by its text alone.

use std::{env, io};

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};

/// `path.resolve(directory)` of Node: joined to the working directory when relative, then `.`
/// and `..` removed. Lexical, no file system access besides the working directory, so a symbolic
/// link is not followed.
///
/// # Errors
///
/// The working directory cannot be read or is not UTF-8.
pub fn absolute_normalised(directory: &Utf8Path) -> Result<Utf8PathBuf, io::Error> {
    let absolute = if directory.is_absolute() {
        directory.to_path_buf()
    } else {
        let current = Utf8PathBuf::try_from(env::current_dir()?).map_err(io::Error::other)?;

        current.join(directory)
    };

    let mut kept: Vec<Utf8Component<'_>> = Vec::new();

    for component in absolute.components() {
        match component {
            Utf8Component::CurDir => {}
            Utf8Component::ParentDir => {
                if matches!(kept.last(), Some(Utf8Component::Normal(_))) {
                    kept.pop();
                }
            }
            Utf8Component::Normal(_) | Utf8Component::RootDir | Utf8Component::Prefix(_) => {
                kept.push(component);
            }
        }
    }

    Ok(kept.iter().map(Utf8Component::as_str).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalised(text: &str) -> String {
        absolute_normalised(Utf8Path::new(text))
            .expect("a path")
            .into_string()
    }

    #[test]
    fn dot_and_parent_segments_are_removed_without_touching_the_disk() {
        assert_eq!(normalised("/a/./b/../c//d"), "/a/c/d");
        assert_eq!(normalised("/../a"), "/a");
        assert_eq!(normalised("/"), "/");
    }

    #[test]
    fn a_relative_path_is_joined_to_the_working_directory() {
        let current = env::current_dir().expect("a working directory");
        let current = Utf8PathBuf::try_from(current).expect("UTF-8");

        assert_eq!(normalised("x/../y"), current.join("y").as_str());
    }
}
