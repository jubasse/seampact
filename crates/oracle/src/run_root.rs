//! The run root of a CLI case: a fresh copy of its `tree/` in a temporary directory, with the
//! bare repository of its `git-source/` beside the tree's content, as `scripts/oracle/tool-cli.ts`
//! and `git-source.ts` build it.

use std::fs;
use std::process::Command;

use camino::{Utf8Path, Utf8PathBuf};
use tempfile::TempDir;

use crate::CliCase;
use crate::fixtures::{child_directories, child_entries, file_name_of};

/// How every expected text of a CLI case writes the run root.
pub const ROOT_TOKEN: &str = "<root>";

/// The bare repository the harness builds from `git-source/`, relative to the run root.
pub const GIT_SOURCE_REPOSITORY: &str = "git-source.git";

const TREE_DIRECTORY: &str = "tree";

const GIT_SOURCE_DIRECTORY: &str = "git-source";

const RUN_ROOT_PREFIX: &str = "seampact-oracle-cli-";

const MAIN_BRANCH: &str = "main";

/// The author, committer and dates of `git-source.ts`: the same case gives the same repository
/// on every machine.
const GIT_ENVIRONMENT: [(&str, &str); 8] = [
    ("GIT_AUTHOR_NAME", "oracle"),
    ("GIT_AUTHOR_EMAIL", "oracle@example.invalid"),
    ("GIT_AUTHOR_DATE", "2026-01-01T00:00:00Z"),
    ("GIT_COMMITTER_NAME", "oracle"),
    ("GIT_COMMITTER_EMAIL", "oracle@example.invalid"),
    ("GIT_COMMITTER_DATE", "2026-01-01T00:00:00Z"),
    ("GIT_CONFIG_GLOBAL", "/dev/null"),
    ("GIT_CONFIG_SYSTEM", "/dev/null"),
];

/// A prepared run root, removed when dropped.
#[derive(Debug)]
pub struct RunRoot {
    /// Removes the root on drop.
    _directory: TempDir,
    path: Utf8PathBuf,
}

impl RunRoot {
    /// The root's canonical path, the text every expected file writes [`ROOT_TOKEN`].
    #[must_use]
    pub fn path(&self) -> &Utf8Path {
        &self.path
    }
}

/// A fresh run root for `case`: its tree copied, its git source built when it has one.
///
/// # Errors
///
/// When the temporary directory, the copy or a git command fails; the message names the fix.
pub fn prepared_run_root(case: &CliCase) -> Result<RunRoot, String> {
    let temporary = fs::canonicalize(std::env::temp_dir())
        .map_err(|error| format!("cannot resolve the temporary directory: {error}"))?;
    let directory = tempfile::Builder::new()
        .prefix(RUN_ROOT_PREFIX)
        .tempdir_in(temporary)
        .map_err(|error| format!("cannot create a temporary directory: {error}"))?;
    let path = Utf8PathBuf::from_path_buf(directory.path().to_path_buf()).map_err(|path| {
        format!(
            "the temporary directory {} is no UTF-8 path",
            path.display()
        )
    })?;

    let root = RunRoot {
        _directory: directory,
        path,
    };

    copy_tree(&case.directory.join(TREE_DIRECTORY), root.path())?;

    let git_source = case.directory.join(GIT_SOURCE_DIRECTORY);

    if git_source.is_dir() {
        build_git_source(&git_source, root.path())?;
    }

    Ok(root)
}

/// Copies every file and directory below `source` into `target`; a symbolic link is refused, since
/// no case holds one and a copy would follow it.
fn copy_tree(source: &Utf8Path, target: &Utf8Path) -> Result<(), String> {
    let entries = child_entries(source).map_err(|error| error.to_string())?;

    for entry in entries {
        let name = file_name_of(&entry).map_err(|error| error.to_string())?;
        let copied = target.join(name);
        let kind = fs::symlink_metadata(&entry)
            .map_err(|error| format!("cannot read {entry}: {error}"))?
            .file_type();

        if kind.is_symlink() {
            return Err(format!(
                "{entry} is a symbolic link: replace it by the file or directory it names"
            ));
        }

        if kind.is_dir() {
            fs::create_dir(&copied).map_err(|error| format!("cannot create {copied}: {error}"))?;
            copy_tree(&entry, &copied)?;

            continue;
        }

        fs::copy(&entry, &copied).map_err(|error| format!("cannot copy {entry}: {error}"))?;
    }

    Ok(())
}

/// Builds `<root>/git-source.git`: one commit per tag directory in name order, whose tree is that
/// directory alone, tagged with its name.
fn build_git_source(source: &Utf8Path, root: &Utf8Path) -> Result<(), String> {
    let repository = root.join(GIT_SOURCE_REPOSITORY);
    let work_directory = tempfile::Builder::new()
        .prefix("seampact-oracle-git-")
        .tempdir()
        .map_err(|error| format!("cannot create the git work tree: {error}"))?;
    let work = Utf8Path::from_path(work_directory.path()).ok_or_else(|| {
        format!(
            "the git work tree {} is no UTF-8 path",
            work_directory.path().display()
        )
    })?;

    commit_tags(source, root, &repository, work)
}

fn commit_tags(
    source: &Utf8Path,
    root: &Utf8Path,
    repository: &Utf8Path,
    work: &Utf8Path,
) -> Result<(), String> {
    git(
        root,
        &[
            "init",
            "--bare",
            "-q",
            "-b",
            MAIN_BRANCH,
            repository.as_str(),
        ],
    )?;
    git(work, &["init", "-q", "-b", MAIN_BRANCH])?;

    let mut tags = child_directories(source).map_err(|error| error.to_string())?;

    tags.sort();

    for tag_directory in tags {
        let tag = file_name_of(&tag_directory).map_err(|error| error.to_string())?;

        empty_work_tree(work)?;
        copy_tree(&tag_directory, work)?;
        git(work, &["add", "-A", "-f"])?;
        git(work, &["commit", "-q", "--allow-empty", "-m", tag])?;
        git(work, &["tag", tag])?;
    }

    let main_ref = format!("HEAD:refs/heads/{MAIN_BRANCH}");

    git(
        work,
        &["push", "-q", repository.as_str(), &main_ref, "--tags"],
    )
}

fn empty_work_tree(work: &Utf8Path) -> Result<(), String> {
    for entry in child_entries(work).map_err(|error| error.to_string())? {
        if entry.file_name() == Some(".git") {
            continue;
        }

        let removed = if entry.is_dir() {
            fs::remove_dir_all(&entry)
        } else {
            fs::remove_file(&entry)
        };

        removed.map_err(|error| format!("cannot empty the git work tree at {entry}: {error}"))?;
    }

    Ok(())
}

fn git(directory: &Utf8Path, arguments: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .args(arguments)
        .current_dir(directory)
        .envs(GIT_ENVIRONMENT)
        .output()
        .map_err(|error| format!("cannot run git (it must be on the PATH): {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "git {} failed in {directory}: {}",
        arguments.join(" "),
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}
