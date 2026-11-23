//! The bundle cache, by integrity value: `SEAMPACT_CACHE_DIR`, else the OS user cache directory.
//!
//! An entry is written through a temporary directory and a rename, so a reader never sees half of
//! one, and the pinned-bundle check runs again on every read: the cache is a copy, never a trust
//! input.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle::{BUNDLE_INTEGRITY_PREFIX, bundle_base64_decoded, bundle_hex};
use seampact_paths::RelativeOutputPath;
use tempfile::Builder;

use crate::BundleFetchError;
use crate::environment::{Environment, process_environment};

/// The variable that names the cache root.
pub const CACHE_DIRECTORY_VARIABLE: &str = "SEAMPACT_CACHE_DIR";

const CACHE_NAME: &str = "seampact";
const BUNDLES_DIRECTORY: &str = "bundles";
const TEMPORARY_PREFIX: &str = ".incoming-";
const TEMPORARY_SUFFIX_CHARACTERS: usize = 16;
/// A SHA-256 digest in padded standard base64: 43 characters and one `=`.
const DIGEST_BASE64_CHARACTERS: usize = 43;

/// The operating system whose user cache directory convention applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CachePlatform {
    /// `LOCALAPPDATA`.
    Windows,
    /// `~/Library/Caches`.
    MacOs,
    /// `XDG_CACHE_HOME`, else `~/.cache`.
    Other,
}

impl CachePlatform {
    /// The platform this build runs on.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Other
        }
    }
}

/// The cache root for `env` on `platform`, with `home` the user's home directory.
#[must_use]
pub fn bundle_cache_directory(
    env: &Environment,
    platform: CachePlatform,
    home: &Utf8Path,
) -> Utf8PathBuf {
    let variable = |name: &str| non_empty(env.get(name).map(String::as_str));

    if let Some(configured) = variable(CACHE_DIRECTORY_VARIABLE) {
        return Utf8PathBuf::from(configured);
    }

    match platform {
        CachePlatform::Windows => variable("LOCALAPPDATA")
            .map_or_else(|| home.join("AppData").join("Local"), Utf8PathBuf::from)
            .join(CACHE_NAME)
            .join("Cache"),
        CachePlatform::MacOs => home.join("Library").join("Caches").join(CACHE_NAME),
        CachePlatform::Other => variable("XDG_CACHE_HOME")
            .map_or_else(|| home.join(".cache"), Utf8PathBuf::from)
            .join(CACHE_NAME),
    }
}

/// The cache root of this process: its environment, platform and user home.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when the user's home directory is unknown or not UTF-8.
pub(crate) fn process_cache_directory() -> Result<Utf8PathBuf, BundleFetchError> {
    let home = std::env::home_dir()
        .ok_or_else(|| BundleFetchError::Io {
            path: "home directory".to_owned(),
            message: "the user's home directory is unknown".to_owned(),
        })
        .and_then(|home| {
            Utf8PathBuf::from_path_buf(home).map_err(|home| BundleFetchError::Io {
                path: home.display().to_string(),
                message: "the user's home directory is not UTF-8".to_owned(),
            })
        })?;

    Ok(bundle_cache_directory(
        &process_environment(),
        CachePlatform::current(),
        &home,
    ))
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// The cache entry of `integrity` below `cache_directory`, or `None` when `integrity` is not a
/// `sha256-` value of a 32-byte digest (a pin the check refuses before any cache read).
#[must_use]
pub fn bundle_cache_entry(cache_directory: &Utf8Path, integrity: &str) -> Option<Utf8PathBuf> {
    let encoded = integrity.strip_prefix(BUNDLE_INTEGRITY_PREFIX)?;
    let characters = encoded.strip_suffix('=')?;

    if characters.chars().count() != DIGEST_BASE64_CHARACTERS {
        return None;
    }

    let digest = bundle_base64_decoded(characters)?;

    Some(
        cache_directory
            .join(BUNDLES_DIRECTORY)
            .join(format!("{BUNDLE_INTEGRITY_PREFIX}{}", bundle_hex(&digest))),
    )
}

/// Copies the verified bundle `directory` to `entry` through a temporary directory and a rename;
/// an entry another run stored meanwhile stands.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when the entry cannot be stored and none exists afterwards.
pub fn store_bundle_cache_entry(
    directory: &Utf8Path,
    entry: &Utf8Path,
) -> Result<(), BundleFetchError> {
    if entry.exists() {
        return Ok(());
    }

    let parent = entry.parent().unwrap_or(entry);

    fs::create_dir_all(parent).map_err(|error| BundleFetchError::io(parent, &error))?;

    let incoming = Builder::new()
        .prefix(TEMPORARY_PREFIX)
        .rand_bytes(TEMPORARY_SUFFIX_CHARACTERS)
        .tempdir_in(parent)
        .map_err(|error| BundleFetchError::io(parent, &error))?;
    let incoming_path =
        Utf8Path::from_path(incoming.path()).ok_or_else(|| BundleFetchError::Io {
            path: incoming.path().display().to_string(),
            message: "the temporary directory is not UTF-8".to_owned(),
        })?;
    let stored =
        copy_directory(directory, incoming_path).and_then(|()| fs::rename(incoming_path, entry));

    // A failed copy leaves `incoming` to remove itself on drop.
    match stored {
        Ok(()) => Ok(()),
        Err(_) if entry.exists() => Ok(()),
        Err(error) => Err(BundleFetchError::Io {
            path: entry.to_string(),
            message: format!(
                "storing the cache entry failed: {error}. Check that {CACHE_DIRECTORY_VARIABLE} or the user cache directory is writable."
            ),
        }),
    }
}

/// Copies the files and directories below `from` into the existing directory `to`.
fn copy_directory(from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
    for child in from.read_dir_utf8()? {
        let child = child?;
        let name = RelativeOutputPath::try_new(child.file_name())
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
        let target = to.join(name.as_path());
        let kind = child.file_type()?;

        if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_directory(child.path(), &target)?;
        } else {
            fs::copy(child.path(), &target)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/home/user";

    fn environment(entries: &[(&str, &str)]) -> Environment {
        entries
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect()
    }

    fn directory(entries: &[(&str, &str)], platform: CachePlatform) -> String {
        bundle_cache_directory(&environment(entries), platform, Utf8Path::new(HOME)).to_string()
    }

    #[test]
    fn the_cache_variable_wins_on_every_platform() {
        assert_eq!(
            directory(&[("SEAMPACT_CACHE_DIR", "/cache")], CachePlatform::Windows),
            "/cache"
        );
    }

    #[test]
    fn an_empty_variable_counts_as_unset() {
        assert_eq!(
            directory(&[("XDG_CACHE_HOME", "/xdg")], CachePlatform::Other),
            "/xdg/seampact"
        );
        assert_eq!(
            directory(&[("XDG_CACHE_HOME", "")], CachePlatform::Other),
            "/home/user/.cache/seampact"
        );
        assert_eq!(
            directory(&[("SEAMPACT_CACHE_DIR", "")], CachePlatform::Other),
            "/home/user/.cache/seampact"
        );
    }

    #[test]
    fn each_platform_has_its_user_cache() {
        assert_eq!(
            directory(&[("XDG_CACHE_HOME", "/xdg")], CachePlatform::MacOs),
            "/home/user/Library/Caches/seampact"
        );
        assert_eq!(
            directory(&[("LOCALAPPDATA", "/local")], CachePlatform::Windows),
            "/local/seampact/Cache"
        );
        assert_eq!(
            directory(&[], CachePlatform::Windows),
            "/home/user/AppData/Local/seampact/Cache"
        );
    }

    #[test]
    fn an_entry_is_named_by_the_hex_of_the_digest() {
        let entry = bundle_cache_entry(
            Utf8Path::new("/cache"),
            "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLDs=",
        );

        assert_eq!(
            entry.map(Utf8PathBuf::into_string),
            Some(
                "/cache/bundles/sha256-9b50f1e462ff27396d78cc79a2305e5db447055f16c7b620037fafe61e312c3b"
                    .to_owned()
            )
        );
    }

    #[test]
    fn a_value_that_is_no_sha256_pin_has_no_entry() {
        for integrity in [
            "",
            "sha512-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLDs=",
            "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLDs",
            "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLD=",
            "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3-v5h4xLDs=",
            "sha256-m1Dx5GL/JzlteMx5ojBeXbRHBV8Wx7YgA3+v5h4xLD\u{e9}=",
        ] {
            assert_eq!(
                bundle_cache_entry(Utf8Path::new("/cache"), integrity),
                None,
                "integrity {integrity:?}"
            );
        }
    }

    #[test]
    fn an_entry_is_stored_once_and_a_stored_entry_stands() {
        let root = tempfile::tempdir().unwrap();
        let root_path = Utf8Path::from_path(root.path()).unwrap();
        let bundle = root_path.join("bundle");

        fs::create_dir_all(bundle.join("ir")).unwrap();
        fs::write(bundle.join("ir/api.json"), "{}").unwrap();

        let entry = root_path.join("cache/bundles/sha256-x");

        store_bundle_cache_entry(&bundle, &entry).unwrap();
        fs::write(bundle.join("ir/api.json"), "changed").unwrap();
        store_bundle_cache_entry(&bundle, &entry).unwrap();

        assert_eq!(fs::read_to_string(entry.join("ir/api.json")).unwrap(), "{}");
        assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);
    }
}
