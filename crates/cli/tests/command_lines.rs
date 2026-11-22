//! Command lines no oracle case runs: no command, the waiting flags, and a compile error under
//! `lint` and `diff`.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli::{EXIT_REFUSED, EXIT_USAGE};

mod common;

use common::{TestResult, empty_directory, run};

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
    let (_guard, baseline_path) = empty_directory()?;
    let (exit, io) = run(
        &broken_contract_app(),
        &["diff", "--against", baseline_path.as_str()],
    )?;

    assert_eq!(exit, EXIT_REFUSED, "{}", io.stderr);
    assert!(io.stderr.contains("diff.against.invalid"), "{}", io.stderr);

    Ok(())
}
