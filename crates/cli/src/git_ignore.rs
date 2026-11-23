//! The `.gitignore` of a directory, with the entries `init` adds to it.

use std::fs;
use std::io::ErrorKind;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::is_symbolic_link;
use seampact_js::is_ecmascript_white_space;
use seampact_paths::node_path;

use crate::CliError;
use crate::line_end::{first_line_end, split_lines};

const GIT_IGNORE_FILE: &str = ".gitignore";

/// How `.gitignore` changes: created, given the missing entries at its end, or already holding
/// them all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GitIgnoreChange {
    /// The file did not exist; `text` is the entries.
    Created { file: Utf8PathBuf, text: String },
    /// The file lacks some entries; `text` is the file with them added at its end.
    Appended { file: Utf8PathBuf, text: String },
    /// The file holds every entry; `text` is the file as it is.
    Unchanged { file: Utf8PathBuf, text: String },
    /// The file is a symbolic link: writing it would change its target, maybe outside the project.
    Link { file: Utf8PathBuf },
}

fn without_trailing_slash(pattern: &str) -> &str {
    pattern.trim_end_matches('/')
}

/// The `.gitignore` of `directory` holding each entry (such as `.seampact/`) once.
///
/// A line counts when it is the entry with or without its trailing slash; a leading slash anchors
/// a pattern to the root, so `/.seampact/` does not count for `.seampact/`. Lines added end as the
/// file's first line does.
///
/// # Errors
///
/// [`CliError::Config`] when the link check fails, [`CliError::Io`] when the file cannot be read.
pub(crate) fn git_ignore_with_entries(
    directory: &Utf8Path,
    entries: &[&str],
) -> Result<GitIgnoreChange, CliError> {
    let file = node_path::resolve(directory, GIT_IGNORE_FILE);

    if is_symbolic_link(&file)? {
        return Ok(GitIgnoreChange::Link { file });
    }

    let existing = match fs::read(&file) {
        Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => return Err(CliError::io(&file, &error)),
    };
    let existing_text = existing.as_deref().unwrap_or_default();
    let present: Vec<&str> = split_lines(existing_text)
        .into_iter()
        .map(|line| without_trailing_slash(line.trim_matches(is_ecmascript_white_space)))
        .collect();
    let mut missing: Vec<&str> = Vec::new();

    for entry in entries {
        if !present.contains(&without_trailing_slash(entry)) && !missing.contains(entry) {
            missing.push(entry);
        }
    }

    let line_end = first_line_end(existing_text).map_or("\n", |(_, end)| end);
    let mut added = String::new();

    for entry in &missing {
        added.push_str(entry);
        added.push_str(line_end);
    }

    let Some(existing) = existing else {
        return Ok(GitIgnoreChange::Created { file, text: added });
    };

    if missing.is_empty() {
        return Ok(GitIgnoreChange::Unchanged {
            file,
            text: existing,
        });
    }

    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        line_end
    };

    Ok(GitIgnoreChange::Appended {
        file,
        text: format!("{existing}{separator}{added}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENTRY: &str = ".seampact/";

    fn change_for(existing: Option<&str>) -> Result<GitIgnoreChange, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = Utf8PathBuf::from_path_buf(directory.path().to_path_buf())
            .map_err(|path| format!("not UTF-8: {}", path.display()))?;

        if let Some(existing) = existing {
            fs::write(path.join(GIT_IGNORE_FILE), existing)?;
        }

        let change = git_ignore_with_entries(&path, &[ENTRY])?;

        Ok(match change {
            GitIgnoreChange::Created { text, .. } => GitIgnoreChange::Created {
                file: Utf8PathBuf::new(),
                text,
            },
            GitIgnoreChange::Appended { text, .. } => GitIgnoreChange::Appended {
                file: Utf8PathBuf::new(),
                text,
            },
            GitIgnoreChange::Unchanged { text, .. } => GitIgnoreChange::Unchanged {
                file: Utf8PathBuf::new(),
                text,
            },
            GitIgnoreChange::Link { .. } => GitIgnoreChange::Link {
                file: Utf8PathBuf::new(),
            },
        })
    }

    fn text_of(change: GitIgnoreChange) -> Option<String> {
        match change {
            GitIgnoreChange::Created { text, .. }
            | GitIgnoreChange::Appended { text, .. }
            | GitIgnoreChange::Unchanged { text, .. } => Some(text),
            GitIgnoreChange::Link { .. } => None,
        }
    }

    #[test]
    fn the_entry_is_added_after_the_file_ending_it_already_has()
    -> Result<(), Box<dyn std::error::Error>> {
        let cases = [
            (None, ".seampact/\n", "created"),
            (
                Some("node_modules"),
                "node_modules\n.seampact/\n",
                "appended",
            ),
            (Some("a\r\nb\r\n"), "a\r\nb\r\n.seampact/\r\n", "appended"),
            (Some(""), ".seampact/\n", "appended"),
            (
                Some("/.seampact/\n"),
                "/.seampact/\n.seampact/\n",
                "appended",
            ),
            (Some(".seampact\n"), ".seampact\n", "unchanged"),
            (Some("  .seampact/ \n"), "  .seampact/ \n", "unchanged"),
        ];

        for (existing, expected, kind) in cases {
            let change = change_for(existing)?;
            let actual_kind = match &change {
                GitIgnoreChange::Created { .. } => "created",
                GitIgnoreChange::Appended { .. } => "appended",
                GitIgnoreChange::Unchanged { .. } => "unchanged",
                GitIgnoreChange::Link { .. } => "link",
            };

            assert_eq!(actual_kind, kind, "existing {existing:?}");
            assert_eq!(
                text_of(change).as_deref(),
                Some(expected),
                "existing {existing:?}"
            );
        }

        Ok(())
    }

    #[test]
    fn a_symbolic_link_is_reported_and_not_read() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = Utf8PathBuf::from_path_buf(directory.path().to_path_buf())
            .map_err(|path| format!("not UTF-8: {}", path.display()))?;

        std::os::unix::fs::symlink(path.join("elsewhere"), path.join(GIT_IGNORE_FILE))?;

        let change = git_ignore_with_entries(&path, &[ENTRY])?;

        assert!(matches!(change, GitIgnoreChange::Link { .. }), "{change:?}");

        Ok(())
    }
}
