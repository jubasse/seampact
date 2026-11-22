//! The git-tag channel: a shallow fetch of the tag with the system `git` into a new bare
//! repository, then the files of the tag's tree.
//!
//! Only `https:` and `ssh` repositories are fetched, plus local ones (`file:` or a path) when
//! local sources are allowed; `ext::` is off. Every command names the temporary repository by
//! `--git-dir`.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle::GitBundleSource;
use tempfile::Builder;

use crate::fetched::Fetched;
use crate::git_run::{FETCH_TIMEOUT, GitFailure, GitRunner, git_failed};
use crate::git_source::{bundle_directory_prefix, git_source_problem, repository_url};
use crate::git_tree::write_tree;
use crate::removed_on_drop::RemovedOnDrop;
use crate::{BundleFetchError, BundleSourceFailure, LocalSourcePolicy};

const TEMPORARY_PREFIX: &str = "seampact-git-";
const REPOSITORY: &str = "repository";
const FILES: &str = "files";

/// Fetches the tag of `source` into a temporary directory.
///
/// # Errors
///
/// [`BundleFetchError::Io`] when the temporary directory cannot be made or a local path resolved.
pub(crate) fn fetch_git_bundle(
    source: &GitBundleSource,
    base_directory: &Utf8Path,
    local_sources: LocalSourcePolicy,
) -> Result<Fetched, BundleFetchError> {
    if let Some(problem) = git_source_problem(source, local_sources) {
        return Ok(Fetched::Failed(problem));
    }

    let url = repository_url(&source.url, base_directory)?;
    let prefix = bundle_directory_prefix(source.directory.as_deref()).unwrap_or_default();
    let temporary = Builder::new()
        .prefix(TEMPORARY_PREFIX)
        .tempdir()
        .map_err(|error| BundleFetchError::Io {
            path: TEMPORARY_PREFIX.to_owned(),
            message: error.to_string(),
        })?
        .keep();
    let removal = RemovedOnDrop::new(Utf8PathBuf::from_path_buf(temporary).map_err(|path| {
        BundleFetchError::Io {
            path: path.display().to_string(),
            message: "the temporary directory is not UTF-8".to_owned(),
        }
    })?);
    let git = GitRunner::new(removal.path().join(REPOSITORY), local_sources);
    let directory = removal.path().join(FILES);

    match fetch_tree(&git, &url, &source.tag, &prefix, &directory) {
        Ok(None) => Ok(Fetched::Directory { directory, removal }),
        Ok(Some(failure)) => Ok(Fetched::Failed(failure)),
        Err(failure) => Ok(Fetched::Failed(git_failed(source, &failure))),
    }
}

fn fetch_tree(
    git: &GitRunner,
    url: &str,
    tag: &str,
    prefix: &str,
    directory: &Utf8Path,
) -> Result<Option<BundleSourceFailure>, GitFailure> {
    git.run(&["init", "--quiet", "--bare"], None)?;
    git.run(
        &[
            "fetch",
            "--quiet",
            "--depth",
            "1",
            "--no-tags",
            "--",
            url,
            &format!("refs/tags/{tag}"),
        ],
        Some(FETCH_TIMEOUT),
    )?;

    write_tree(git, prefix, directory)
}
