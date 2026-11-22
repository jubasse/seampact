//! Command lines no oracle case runs: no command, the waiting flags, and a compile error under
//! `lint` and `diff`.

use std::ffi::OsString;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli::{CliError, CliIo, EXIT_REFUSED, EXIT_USAGE, run_command};

type TestResult = Result<(), Box<dyn std::error::Error>>;

struct RecordingIo {
    cwd: Utf8PathBuf,
    stdout: String,
    stderr: String,
}

impl RecordingIo {
    fn in_directory(cwd: &Utf8Path) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
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

    fn environment_variable(&self, _name: &str) -> Option<String> {
        None
    }

    fn today(&self) -> String {
        "2026-01-01".to_owned()
    }
}

fn run(cwd: &Utf8Path, words: &[&str]) -> Result<(i32, RecordingIo), CliError> {
    let command_line: Vec<OsString> = words.iter().map(OsString::from).collect();
    let mut streams = RecordingIo::in_directory(cwd);
    let exit = run_command(&command_line, &mut streams)?;

    Ok((exit, streams))
}

fn broken_contract_app() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/cli/compile-error/tree")
}

#[test]
fn no_command_is_a_usage_error_that_prints_the_usage() -> TestResult {
    let (exit, io) = run(Utf8Path::new("."), &[])?;

    assert_eq!(exit, EXIT_USAGE);
    assert!(io.stderr.contains("cli.usage"), "{}", io.stderr);
    assert!(
        io.stderr.contains("Usage: seampact <command>"),
        "{}",
        io.stderr
    );

    Ok(())
}

#[test]
fn a_flag_that_is_not_available_yet_exits_2_and_says_so() -> TestResult {
    for flag in ["--watch", "--strict", "--source-map", "--strict=true"] {
        let (exit, io) = run(Utf8Path::new("."), &["compile", flag])?;

        assert_eq!(exit, EXIT_USAGE, "{flag}");
        assert!(io.stderr.contains("cli.not-available"), "{flag}");
    }

    Ok(())
}

#[test]
fn lint_exits_non_zero_when_a_contract_has_a_compile_error() -> TestResult {
    let (exit, io) = run(&broken_contract_app(), &["lint"])?;

    assert_eq!(exit, EXIT_REFUSED, "{}", io.stderr);

    Ok(())
}

#[test]
fn diff_exits_non_zero_against_a_directory_with_no_ir_file() -> TestResult {
    let baseline = tempfile::tempdir()?;
    let baseline_path =
        Utf8PathBuf::from_path_buf(baseline.path().to_path_buf()).expect("a UTF-8 path");
    let (exit, io) = run(
        &broken_contract_app(),
        &["diff", "--against", baseline_path.as_str()],
    )?;

    assert_eq!(exit, EXIT_REFUSED, "{}", io.stderr);
    assert!(io.stderr.contains("diff.against.invalid"), "{}", io.stderr);

    Ok(())
}
