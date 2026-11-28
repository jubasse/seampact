//! The api names a workspace file declares, and the limits of reading it.

use std::fmt::Write;
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use seampact_generate::workspace_api_names;

type TestResult = Result<(), Box<dyn std::error::Error>>;

const MANY_KEYS: usize = 60_000;
const TIME_LIMIT: Duration = Duration::from_secs(1);

fn directory_with_workspace(
    text: &str,
) -> Result<(tempfile::TempDir, Utf8PathBuf), std::io::Error> {
    let guard = tempfile::tempdir()?;
    let directory = Utf8PathBuf::from_path_buf(guard.path().to_path_buf())
        .map_err(|path| std::io::Error::other(format!("{} is not UTF-8", path.display())))?;

    std::fs::write(directory.join("workspace.yaml"), text)?;

    Ok((guard, directory))
}

fn mapping_of_keys(count: usize, repeated_last: bool) -> Result<String, std::fmt::Error> {
    let mut text = String::from("workspace:\n  apis:\n    one: x\n  other:\n");

    for index in 0..count {
        writeln!(text, "    k{index}: 1")?;
    }

    if repeated_last {
        writeln!(text, "    k0: 2")?;
    }

    Ok(text)
}

#[test]
fn a_mapping_of_many_keys_is_read_in_linear_time() -> TestResult {
    let (_guard, directory) = directory_with_workspace(&mapping_of_keys(MANY_KEYS, false)?)?;
    let started = Instant::now();

    assert_eq!(
        workspace_api_names(&directory),
        Some(vec!["one".to_owned()])
    );
    assert!(
        started.elapsed() < TIME_LIMIT,
        "took {:?}",
        started.elapsed()
    );

    Ok(())
}

#[test]
fn a_repeated_key_among_many_still_answers_none() -> TestResult {
    let (_guard, directory) = directory_with_workspace(&mapping_of_keys(MANY_KEYS, true)?)?;
    let started = Instant::now();

    assert_eq!(workspace_api_names(&directory), None);
    assert!(
        started.elapsed() < TIME_LIMIT,
        "took {:?}",
        started.elapsed()
    );

    Ok(())
}

#[test]
fn a_workspace_file_above_the_loader_size_limit_answers_none() -> TestResult {
    let (_guard, directory) = directory_with_workspace(&format!(
        "workspace:\n  apis:\n    one: x\n# {}\n",
        "x".repeat(5 * 1024 * 1024)
    ))?;

    assert_eq!(workspace_api_names(&directory), None);

    Ok(())
}
