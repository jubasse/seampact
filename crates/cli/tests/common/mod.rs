// The streams and environment a test runs a command line with.

use std::ffi::OsString;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli::{CliError, run_command};
use seampact_cli_config::CliIo;

pub type TestResult = Result<(), Box<dyn std::error::Error>>;

/// The working directory, the environment and the text the command wrote.
pub struct RecordingIo {
    cwd: Utf8PathBuf,
    environment: Vec<(&'static str, &'static str)>,
    pub stdout: String,
    pub stderr: String,
}

impl RecordingIo {
    fn in_directory(cwd: &Utf8Path, environment: &[(&'static str, &'static str)]) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
            environment: environment.to_vec(),
            stdout: String::new(),
            stderr: String::new(),
        }
    }
}

impl CliIo for RecordingIo {
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
            .map(|(_, value)| (*value).to_owned())
    }

    fn today(&self) -> String {
        "2026-01-01".to_owned()
    }
}

/// Runs the command line `words` in `cwd` with no environment variable set.
pub fn run(cwd: &Utf8Path, words: &[&str]) -> Result<(i32, RecordingIo), CliError> {
    run_with_environment(cwd, &[], words)
}

/// Runs the command line `words` in `cwd` with the variables `environment` set.
pub fn run_with_environment(
    cwd: &Utf8Path,
    environment: &[(&'static str, &'static str)],
    words: &[&str],
) -> Result<(i32, RecordingIo), CliError> {
    let command_line: Vec<OsString> = words.iter().map(OsString::from).collect();
    let mut streams = RecordingIo::in_directory(cwd, environment);
    let exit = run_command(&command_line, &mut streams)?;

    Ok((exit, streams))
}

/// A new empty directory, removed with the returned guard.
pub fn empty_directory() -> Result<(tempfile::TempDir, Utf8PathBuf), Box<dyn std::error::Error>> {
    let guard = tempfile::tempdir()?;
    let path = Utf8PathBuf::from_path_buf(guard.path().to_path_buf())
        .map_err(|path| format!("not a UTF-8 path: {}", path.display()))?;

    Ok((guard, path))
}
