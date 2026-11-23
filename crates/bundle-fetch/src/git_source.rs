//! What a git source names: its URL, its tag and its directory, checked before any `git` runs.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle::resolve_directory;
use seampact_bundle_source::GitBundleSource;
use seampact_diagnostics::{InternalError, quote_text};
use url::Url;

use crate::printable_url::printable_url;
use crate::{BundleFetchError, BundleSourceFailure, BundleSourceFailureCode, LocalSourcePolicy};

/// The protocols a remote repository is fetched over, as `GIT_ALLOW_PROTOCOL` lists them.
pub(crate) const REMOTE_PROTOCOLS: &str = "https:ssh";
/// The scheme of a local repository.
pub(crate) const LOCAL_PROTOCOL: &str = "file";

const ALLOWED_SCHEMES: [&str; 3] = ["https", "ssh", LOCAL_PROTOCOL];
/// The shortest host of an scp-like address: a drive letter is one character.
const SCP_HOST_CHARACTERS_MIN: usize = 2;

/// The scheme of a `scheme://` URL, as written: `^([A-Za-z][A-Za-z0-9+.-]*):\/\/`.
fn url_scheme(url: &str) -> Option<&str> {
    let (scheme, _) = url.split_once("://")?;
    let mut characters = scheme.chars();
    let starts_with_letter = characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic());

    (starts_with_letter
        && characters
            .all(|character| character.is_ascii_alphanumeric() || "+.-".contains(character)))
    .then_some(scheme)
}

/// `^[A-Za-z]:[\\/]`.
fn is_drive_path(url: &str) -> bool {
    let mut characters = url.chars();

    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && characters.next() == Some(':')
        && matches!(characters.next(), Some('/' | '\\'))
}

/// `[user@]host:path`, git's scp-like ssh form: a colon before any slash, after a host longer than
/// a drive letter (`^[^/:]{2,}:`).
fn is_scp_like(url: &str) -> bool {
    let host_characters = url
        .chars()
        .take_while(|character| !matches!(character, '/' | ':'))
        .count();

    host_characters >= SCP_HOST_CHARACTERS_MIN && url.chars().nth(host_characters) == Some(':')
}

fn is_local_repository(url: &str) -> bool {
    if let Some(scheme) = url_scheme(url) {
        return scheme.eq_ignore_ascii_case(LOCAL_PROTOCOL);
    }

    is_drive_path(url) || !is_scp_like(url)
}

/// Why the source's URL, directory or tag cannot be fetched, before any `git` runs.
pub(crate) fn git_source_problem(
    source: &GitBundleSource,
    local_sources: LocalSourcePolicy,
) -> Option<BundleSourceFailure> {
    let url = source.url.as_str();

    if let Some(scheme) = url_scheme(url).map(str::to_ascii_lowercase)
        && !ALLOWED_SCHEMES.contains(&scheme.as_str())
    {
        return Some(BundleSourceFailure::new(
            BundleSourceFailureCode::GitUrl,
            format!(
                "The git URL {} uses '{scheme}:'; a bundle is fetched over https: or ssh only.",
                quote_text(&printable_url(url))
            ),
            "Name the repository by its https: or ssh URL.",
        ));
    }

    if is_local_repository(url) && local_sources == LocalSourcePolicy::Refuse {
        return Some(BundleSourceFailure::new(
            BundleSourceFailureCode::SourceLocal,
            format!(
                "The git repository {} is local, and local sources are refused here.",
                quote_text(&printable_url(url))
            ),
            "Name the repository by its https: or ssh URL.",
        ));
    }

    if bundle_directory_prefix(source.directory.as_deref()).is_none() {
        return Some(bad_directory(source.directory.as_deref()));
    }

    if source.tag.starts_with('-') || source.tag.contains("..") {
        return Some(bad_tag(&source.tag));
    }

    None
}

/// The URL `git fetch` is given: a local path becomes a `file:` URL, resolved against
/// `base_directory`.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when the working directory is needed and unreadable;
/// [`BundleFetchError::Internal`] when a resolved path is no file URL.
pub(crate) fn repository_url(
    url: &str,
    base_directory: &Utf8Path,
) -> Result<String, BundleFetchError> {
    if !is_local_repository(url) || url_scheme(url).is_some() {
        return Ok(url.to_owned());
    }

    let written = Utf8Path::new(url);
    let resolved = if written.is_absolute() {
        resolve_directory(written)?
    } else {
        resolve_directory(&base_directory.join(written))?
    };

    file_url(&resolved, url.ends_with('/'))
}

/// `pathToFileURL`: a trailing slash of the written path stays.
fn file_url(
    resolved: &Utf8PathBuf,
    keeps_trailing_slash: bool,
) -> Result<String, BundleFetchError> {
    let url = if keeps_trailing_slash {
        Url::from_directory_path(resolved)
    } else {
        Url::from_file_path(resolved)
    };

    url.map(String::from).map_err(|()| {
        InternalError::new(format!(
            "bundle: the repository path '{resolved}' is no file URL."
        ))
        .into()
    })
}

/// The directory of the bundle in the repository as a `tree` path prefix (`""` for the root), or
/// `None` for a path that is not a plain relative one.
pub(crate) fn bundle_directory_prefix(directory: Option<&str>) -> Option<String> {
    let Some(directory) = directory else {
        return Some(String::new());
    };
    let segments: Vec<&str> = directory.trim_end_matches('/').split('/').collect();
    let is_plain = segments.iter().all(|segment| {
        !segment.is_empty() && *segment != "." && *segment != ".." && !segment.contains('\\')
    });

    is_plain.then(|| format!("{}/", segments.join("/")))
}

fn bad_directory(directory: Option<&str>) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::GitDirectory,
        format!(
            "The git directory {} is not a relative path inside the repository.",
            quote_text(directory.unwrap_or(""))
        ),
        "Name the bundle directory relative to the repository root, without '.', '..' or a backslash.",
    )
}

fn bad_tag(tag: &str) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::GitTag,
        format!("The git tag {} is not a tag name.", quote_text(tag)),
        "Name the tag the bundle was committed under.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(url: &str, tag: &str, directory: Option<&str>) -> GitBundleSource {
        GitBundleSource {
            url: url.to_owned(),
            tag: tag.to_owned(),
            directory: directory.map(str::to_owned),
        }
    }

    fn code_of(
        source: &GitBundleSource,
        policy: LocalSourcePolicy,
    ) -> Option<BundleSourceFailureCode> {
        git_source_problem(source, policy).map(|failure| failure.code)
    }

    #[test]
    fn a_repository_is_local_unless_it_is_a_remote_scheme_or_scp_like() {
        for (url, local) in [
            ("file:///repo.git", true),
            ("FILE://host/repo.git", true),
            ("../repo.git", true),
            ("/abs/repo.git", true),
            ("C:\\repo.git", true),
            ("C:/repo.git", true),
            ("a:repo.git", true),
            ("https://h/repo.git", false),
            ("ssh://git@h/repo.git", false),
            ("git@github.com:owner/repo.git", false),
            ("host:repo.git", false),
            // One code point before the colon, as in JavaScript's `u` flag: no scp-like host.
            ("\u{1f600}:repo.git", true),
            ("\u{1f600}\u{1f600}:repo.git", false),
        ] {
            assert_eq!(is_local_repository(url), local, "url {url:?}");
        }
    }

    #[test]
    fn a_source_is_refused_for_its_scheme_its_locality_its_directory_or_its_tag() {
        let allow = LocalSourcePolicy::Allow;
        let refuse = LocalSourcePolicy::Refuse;

        assert_eq!(code_of(&git("https://h/r.git", "v1", None), allow), None);
        assert_eq!(
            code_of(&git("ssh://h/r.git", "v1", Some("bundle/")), allow),
            None
        );
        assert_eq!(code_of(&git("file:///r.git", "v1", None), allow), None);
        assert_eq!(
            code_of(&git("ext::sh -c x://y", "v1", None), allow),
            None,
            "no scheme before `://`"
        );
        assert_eq!(
            code_of(&git("HTTP://h/r.git", "v1", None), allow),
            Some(BundleSourceFailureCode::GitUrl)
        );
        assert_eq!(
            code_of(&git("git://h/r.git", "v1", None), allow),
            Some(BundleSourceFailureCode::GitUrl)
        );
        assert_eq!(
            code_of(&git("file:///r.git", "v1", None), refuse),
            Some(BundleSourceFailureCode::SourceLocal)
        );
        assert_eq!(
            code_of(&git("../r.git", "v1", None), refuse),
            Some(BundleSourceFailureCode::SourceLocal)
        );
        assert_eq!(code_of(&git("https://h/r.git", "v1", None), refuse), None);
        assert_eq!(
            code_of(&git("https://h/r.git", "v1", Some("../x")), allow),
            Some(BundleSourceFailureCode::GitDirectory)
        );
        assert_eq!(
            code_of(&git("https://h/r.git", "-v1", None), allow),
            Some(BundleSourceFailureCode::GitTag)
        );
        assert_eq!(
            code_of(&git("https://h/r.git", "a..b", None), allow),
            Some(BundleSourceFailureCode::GitTag)
        );
    }

    #[test]
    fn a_directory_is_a_plain_relative_path_with_one_trailing_slash() {
        for (directory, prefix) in [
            (None, Some("")),
            (Some("bundle"), Some("bundle/")),
            (Some("a/b///"), Some("a/b/")),
            (Some(""), None),
            (Some("/"), None),
            (Some("/abs"), None),
            (Some("a//b"), None),
            (Some("./a"), None),
            (Some("a/.."), None),
            (Some("a\\b"), None),
        ] {
            assert_eq!(
                bundle_directory_prefix(directory).as_deref(),
                prefix,
                "directory {directory:?}"
            );
        }
    }

    #[test]
    fn a_local_path_becomes_a_file_url_resolved_against_the_base_directory() {
        let base = Utf8Path::new("/work/app/./sub");

        for (url, expected) in [
            ("../repo.git", "file:///work/app/repo.git"),
            ("/abs/../repo.git", "file:///repo.git"),
            ("repo dir/", "file:///work/app/sub/repo%20dir/"),
            ("https://h/r.git", "https://h/r.git"),
            ("file:///r.git", "file:///r.git"),
            ("git@h:o/r.git", "git@h:o/r.git"),
        ] {
            assert_eq!(repository_url(url, base).unwrap(), expected, "url {url:?}");
        }
    }
}
