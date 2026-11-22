//! `seampact init` command lines no oracle case runs: usage errors, refusals before any write, the
//! editor schema policies and the `.gitignore` it extends.

use std::fs;

use camino::Utf8Path;
use seampact_cli::{EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE};

mod common;

use common::{TestResult, empty_directory, run, run_with_environment};

const CONTRACT: &str = "contract/api.yaml";

fn names_in(directory: &Utf8Path) -> Result<Vec<String>, std::io::Error> {
    let mut names = Vec::new();

    for entry in fs::read_dir(directory)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
    }

    names.sort();

    Ok(names)
}

#[test]
fn flags_that_do_not_go_together_are_usage_errors() -> TestResult {
    let (_guard, app) = empty_directory()?;

    for words in [
        ["init", "--editor-schemas=sometimes"].as_slice(),
        ["init", "--modelines", "--blank"].as_slice(),
        ["init", "--config", "other.yaml"].as_slice(),
    ] {
        let (exit, io) = run(&app, words)?;

        assert_eq!(exit, EXIT_USAGE, "{words:?}");
        assert!(
            io.stderr.starts_with("cli.usage: "),
            "{words:?}: {}",
            io.stderr
        );
    }

    assert!(names_in(&app)?.is_empty());

    Ok(())
}

#[test]
fn an_existing_config_or_contract_folder_is_refused_by_name_and_nothing_is_written() -> TestResult {
    let (_guard, app) = empty_directory()?;

    fs::write(app.join("seampact.config.yaml"), "sources: {}\n")?;

    let (exit, io) = run(&app, &["init"])?;

    assert_eq!(exit, EXIT_REFUSED);
    assert!(io.stderr.starts_with("init.file-exists: "), "{}", io.stderr);
    assert!(
        io.stderr.contains("seampact.config.yaml already exists"),
        "{}",
        io.stderr
    );
    assert_eq!(names_in(&app)?, ["seampact.config.yaml"]);

    let (_guard, folder_app) = empty_directory()?;

    fs::create_dir(folder_app.join("contract"))?;
    fs::write(
        folder_app.join("contract/workspace.yaml"),
        "workspace: {}\n",
    )?;

    let (_, io) = run(&folder_app, &["init"])?;

    assert!(
        io.stderr.contains("contract already exists"),
        "{}",
        io.stderr
    );
    assert_eq!(names_in(&folder_app)?, ["contract"]);

    Ok(())
}

#[test]
fn a_dangling_link_where_the_config_goes_is_refused_and_nothing_is_written_through_it() -> TestResult
{
    let (_guard, app) = empty_directory()?;
    let (_elsewhere_guard, elsewhere) = empty_directory()?;

    std::os::unix::fs::symlink(
        elsewhere.join("seampact.config.yaml"),
        app.join("seampact.config.yaml"),
    )?;

    let (exit, io) = run(&app, &["init"])?;

    assert_eq!(exit, EXIT_REFUSED);
    assert!(io.stderr.starts_with("init.file-exists: "), "{}", io.stderr);
    assert!(names_in(&elsewhere)?.is_empty());
    assert_eq!(names_in(&app)?, ["seampact.config.yaml"]);

    Ok(())
}

#[test]
fn init_is_refused_where_local_sources_are_refused_and_writes_nothing() -> TestResult {
    let (_guard, app) = empty_directory()?;
    let (exit, io) = run_with_environment(&app, &[("SEAMPACT_ALLOW_LOCAL", "false")], &["init"])?;

    assert_eq!(exit, EXIT_REFUSED);
    assert!(
        io.stderr.starts_with("init.local-sources-refused: "),
        "{}",
        io.stderr
    );
    assert!(
        io.stderr.contains("SEAMPACT_ALLOW_LOCAL=false"),
        "{}",
        io.stderr
    );
    assert!(names_in(&app)?.is_empty());

    Ok(())
}

#[test]
fn the_ignore_entry_is_appended_once_to_an_existing_gitignore() -> TestResult {
    let (_guard, app) = empty_directory()?;

    fs::write(app.join(".gitignore"), "node_modules")?;
    run(&app, &["init"])?;

    assert_eq!(
        fs::read_to_string(app.join(".gitignore"))?,
        "node_modules\n.seampact/\n"
    );

    let (exit, io) = run(&app, &["init", "--modelines"])?;

    assert_eq!(exit, EXIT_SUCCESS, "{}", io.stderr);
    assert!(!io.stdout.contains(".gitignore"), "{}", io.stdout);
    assert_eq!(
        fs::read_to_string(app.join(".gitignore"))?,
        "node_modules\n.seampact/\n"
    );

    Ok(())
}

#[test]
fn the_none_policy_points_the_modeline_at_the_installed_spec_and_writes_no_schema_nor_ignore_entry()
-> TestResult {
    let (_guard, app) = empty_directory()?;
    let (exit, io) = run(&app, &["init", "--editor-schemas=none"])?;
    let contract = fs::read_to_string(app.join(CONTRACT))?;

    assert_eq!(exit, EXIT_SUCCESS, "{}", io.stderr);
    assert_eq!(
        contract.lines().next(),
        Some(
            "# yaml-language-server: $schema=../node_modules/@seampact/spec/schemas/authoring/api.schema.json"
        )
    );
    assert!(!app.join("contract/.seampact").exists());
    assert!(!app.join(".gitignore").exists());

    Ok(())
}

#[test]
fn no_modelines_and_no_ignore_files_leave_the_modeline_and_the_ignore_file_out() -> TestResult {
    let (_guard, app) = empty_directory()?;

    run(&app, &["init", "--no-modelines", "--no-ignore-files"])?;

    assert!(!fs::read_to_string(app.join(CONTRACT))?.contains("yaml-language-server"));
    assert!(
        app.join("contract/.seampact/schemas/node.schema.json")
            .exists()
    );
    assert!(!app.join(".gitignore").exists());

    Ok(())
}

#[test]
fn a_failure_after_the_first_write_removes_what_init_wrote() -> TestResult {
    let (_guard, parent) = empty_directory()?;
    let app = parent.join("app");

    fs::create_dir(&app)?;
    fs::write(parent.join("seampact.config.yaml"), "apps: [app\n")?;

    let (exit, io) = run(&app, &["init"])?;

    assert_eq!(exit, EXIT_REFUSED);
    assert!(
        io.stderr.contains("init left nothing behind"),
        "{}",
        io.stderr
    );
    assert!(names_in(&app)?.is_empty());

    Ok(())
}
