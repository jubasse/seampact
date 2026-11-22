//! Running `git` against the temporary bare repository, and what its failure says.

use std::io::Read;
use std::process::{Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use seampact_bundle::{BUNDLE_EXTRACTED_BYTES_MAX, GitBundleSource};
use seampact_diagnostics::quote_text;
use seampact_js::is_ecmascript_white_space;

use crate::environment::{Environment, process_environment};
use crate::git_source::{LOCAL_PROTOCOL, REMOTE_PROTOCOLS};
use crate::printable_url::{printable_url, with_printable_url};
use crate::{BundleSourceFailure, BundleSourceFailureCode, LocalSourcePolicy};

const GIT: &str = "git";
const GIT_OUTPUT_BYTES_MAX: usize = BUNDLE_EXTRACTED_BYTES_MAX;
const READ_CHUNK_BYTES: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

/// How long a `git fetch` may run.
pub(crate) const FETCH_TIMEOUT: Duration = Duration::from_millis(60_000);

/// ssh would otherwise ask for a host key or a passphrase on the terminal, which
/// `GIT_TERMINAL_PROMPT` does not cover.
const NON_INTERACTIVE_SSH: &str = "ssh -o BatchMode=yes";
const REPOSITORY_LOCATING_VARIABLES: [&str; 8] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_QUARANTINE_PATH",
];

/// Why a `git` command, or a write of its output, failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GitFailure {
    /// The command ran past its timeout and was killed.
    TimedOut,
    /// The command failed; what it wrote on its error stream.
    Stderr(String),
    /// The command could not run, or a file could not be written; what the system answered.
    Message(String),
}

/// The environment `git` runs in: the inherited one without the variables that locate a
/// repository, so a run from a git hook never touches the user's repository.
pub(crate) fn git_environment(
    inherited: &Environment,
    local_sources: LocalSourcePolicy,
) -> Environment {
    let mut env = inherited.clone();

    for name in REPOSITORY_LOCATING_VARIABLES {
        env.remove(name);
    }

    let protocols = match local_sources {
        LocalSourcePolicy::Allow => format!("{REMOTE_PROTOCOLS}:{LOCAL_PROTOCOL}"),
        LocalSourcePolicy::Refuse => REMOTE_PROTOCOLS.to_owned(),
    };

    env.insert("GIT_ALLOW_PROTOCOL".to_owned(), protocols);
    env.insert("GIT_TERMINAL_PROMPT".to_owned(), "0".to_owned());
    env.insert(
        "GIT_SSH_COMMAND".to_owned(),
        inherited
            .get("GIT_SSH_COMMAND")
            .cloned()
            .unwrap_or_else(|| NON_INTERACTIVE_SSH.to_owned()),
    );

    env
}

/// Runs `git` commands against one repository, in the environment [`git_environment`] builds.
#[derive(Debug)]
pub(crate) struct GitRunner {
    repository: Utf8PathBuf,
    env: Environment,
}

impl GitRunner {
    /// Runs commands against the bare repository `repository`.
    pub(crate) fn new(repository: Utf8PathBuf, local_sources: LocalSourcePolicy) -> Self {
        Self {
            repository,
            env: git_environment(&process_environment(), local_sources),
        }
    }

    /// Runs `git <args>` and answers its standard output; a command past `timeout` is killed.
    pub(crate) fn run(
        &self,
        args: &[&str],
        timeout: Option<Duration>,
    ) -> Result<Vec<u8>, GitFailure> {
        let mut child = Command::new(GIT)
            .args(["-c", "protocol.ext.allow=never"])
            .arg(format!("--git-dir={}", self.repository))
            .args(args)
            .env_clear()
            .envs(&self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitFailure::Message(error.to_string()))?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            return Err(GitFailure::Message(
                "the git command's output streams are not piped".to_owned(),
            ));
        };
        let stdout = read_capped(stdout);
        let stderr = read_capped(stderr);
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {}
                Err(error) => return Err(GitFailure::Message(error.to_string())),
            }

            if timeout.is_some_and(|limit| started.elapsed() >= limit) {
                let killed = child.kill().and_then(|()| child.wait());

                return killed
                    .map_err(|error| GitFailure::Message(error.to_string()))
                    .and(Err(GitFailure::TimedOut));
            }

            thread::sleep(POLL_INTERVAL);
        };
        let stdout = joined(stdout)?;
        let stderr_text = String::from_utf8_lossy(&joined(stderr)?.bytes).into_owned();

        if !status.success() || stdout.exceeded {
            return Err(GitFailure::Stderr(stderr_text));
        }

        Ok(stdout.bytes)
    }
}

/// What a reader thread kept of a stream.
struct CappedBytes {
    bytes: Vec<u8>,
    exceeded: bool,
}

/// Reads a stream to its end on a thread, keeping at most the output cap; the rest is read and
/// dropped, so the command never blocks on a full pipe.
fn read_capped(mut stream: impl Read + Send + 'static) -> JoinHandle<std::io::Result<CappedBytes>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut exceeded = false;
        let mut chunk = vec![0_u8; READ_CHUNK_BYTES];

        loop {
            let read = stream.read(&mut chunk)?;

            if read == 0 {
                return Ok(CappedBytes { bytes, exceeded });
            }

            let room = GIT_OUTPUT_BYTES_MAX.saturating_sub(bytes.len());

            exceeded |= read > room;
            bytes.extend(chunk.iter().take(read.min(room)));
        }
    })
}

fn joined(handle: JoinHandle<std::io::Result<CappedBytes>>) -> Result<CappedBytes, GitFailure> {
    handle
        .join()
        .map_err(|_| GitFailure::Message("a git output reader stopped".to_owned()))?
        .map_err(|error| GitFailure::Message(error.to_string()))
}

/// What a failed command says, as the user reads it after "failed:".
pub(crate) fn git_failure_reason(failure: &GitFailure) -> String {
    match failure {
        GitFailure::TimedOut => format!("it took over {} ms", FETCH_TIMEOUT.as_millis()),
        GitFailure::Stderr(stderr) => stderr.trim_matches(is_ecmascript_white_space).to_owned(),
        GitFailure::Message(message) => message.clone(),
    }
}

/// The failure of fetching the tag of `source`, with the URL as it prints.
pub(crate) fn git_failed(source: &GitBundleSource, failure: &GitFailure) -> BundleSourceFailure {
    BundleSourceFailure::new(
        BundleSourceFailureCode::GitFailed,
        format!(
            "Fetching tag '{}' of {} with git failed: {}.",
            source.tag,
            quote_text(&printable_url(&source.url)),
            quote_text(&with_printable_url(
                &git_failure_reason(failure),
                &source.url
            )),
        ),
        "Check the URL, the tag and your access to the repository, and that `git` is on the PATH.",
    )
}
