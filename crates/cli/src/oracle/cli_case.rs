//! The CLI cases: one command line run in a fresh tree, its streams and file changes recorded.

use std::collections::BTreeMap;
use std::ffi::OsString;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_oracle::{
    CASE_TODAY, CliCase, GIT_SOURCE_REPOSITORY, ROOT_TOKEN, SubjectAnswer, Transcript,
};

use crate::oracle::stub_answer::{StubError, failed_answer};
use crate::{CliError, CliIo, run_command};

impl StubError for CliError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

/// The variable naming the bundle cache directory.
const CACHE_DIRECTORY_VARIABLE: &str = "SEAMPACT_CACHE_DIR";

/// The variable that lets local sources in.
const ALLOW_LOCAL_VARIABLE: &str = "SEAMPACT_ALLOW_LOCAL";

/// The CLI's view of the process while a case runs: the case's directory, environment and date,
/// the streams kept.
#[derive(Debug)]
struct CaseIo {
    cwd: Utf8PathBuf,
    environment: Vec<(&'static str, String)>,
    stdout: String,
    stderr: String,
}

impl CliIo for CaseIo {
    fn cwd(&self) -> &Utf8Path {
        &self.cwd
    }

    fn stdout(&mut self, text: &str) {
        self.stdout.push_str(text);
    }

    fn stderr(&mut self, text: &str) {
        self.stderr.push_str(text);
    }

    fn environment_variable(&self, name: &str) -> Option<String> {
        self.environment
            .iter()
            .find(|(variable, _)| *variable == name)
            .map(|(_, value)| value.clone())
    }

    fn today(&self) -> String {
        CASE_TODAY.to_owned()
    }
}

/// Runs the command of `case` in `root`, a fresh copy of its tree, and records what it printed,
/// wrote and removed.
pub(crate) fn cli_answer(case: &CliCase, root: &Utf8Path) -> SubjectAnswer<Transcript> {
    let before = match files_under(root) {
        Ok(files) => files,
        Err(message) => return SubjectAnswer::InternalError { message },
    };

    let mut environment = vec![(
        CACHE_DIRECTORY_VARIABLE,
        root.join(&case.cache_directory).into_string(),
    )];

    if let Some(allow_local) = &case.allow_local {
        environment.push((ALLOW_LOCAL_VARIABLE, allow_local.clone()));
    }

    let mut io = CaseIo {
        cwd: root.join(&case.cwd),
        environment,
        stdout: String::new(),
        stderr: String::new(),
    };
    let argv: Vec<OsString> = case
        .argv
        .iter()
        .map(|argument| OsString::from(argument.replace(ROOT_TOKEN, root.as_str())))
        .collect();

    let exit = match run_command(&argv, &mut io) {
        Ok(exit) => exit,
        Err(error) => return failed_answer(&error),
    };

    let after = match files_under(root) {
        Ok(files) => files,
        Err(message) => return SubjectAnswer::InternalError { message },
    };

    let removed: Vec<String> = before
        .keys()
        .filter(|path| !after.contains_key(*path))
        .cloned()
        .collect();
    let written: IndexMap<String, Vec<u8>> = after
        .into_iter()
        .filter(|(path, bytes)| before.get(path) != Some(bytes))
        .collect();

    SubjectAnswer::Ported(Transcript {
        exit,
        stdout: io.stdout,
        stderr: io.stderr,
        written,
        removed,
    })
}

/// Every file under `root` by its `/`-separated path relative to `root`, sorted by path; the git
/// source the harness built is not the command's.
fn files_under(root: &Utf8Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut files = BTreeMap::new();
    let mut directories = vec![root.to_path_buf()];

    while let Some(directory) = directories.pop() {
        let entries = directory
            .read_dir_utf8()
            .map_err(|error| format!("cannot list {directory}: {error}"))?;

        for entry in entries {
            let entry = entry.map_err(|error| format!("cannot list {directory}: {error}"))?;
            let path = entry.path().to_path_buf();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("cannot read the type of {path}: {error}"))?;

            if file_type.is_dir() {
                if path != root.join(GIT_SOURCE_REPOSITORY) {
                    directories.push(path);
                }

                continue;
            }

            let relative = path
                .strip_prefix(root)
                .map_err(|error| format!("{path} is outside {root}: {error}"))?;
            let key: Vec<&str> = relative
                .components()
                .map(|component| component.as_str())
                .collect();
            let bytes =
                std::fs::read(&path).map_err(|error| format!("cannot read {path}: {error}"))?;

            files.insert(key.join("/"), bytes);
        }
    }

    Ok(files)
}
