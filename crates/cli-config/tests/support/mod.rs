//! Temporary config trees and readers shared by the config tests.

#![allow(
    dead_code,
    clippy::expect_used,
    clippy::panic,
    reason = "test helpers: a failed lookup is the failed test, and each binary uses part of them"
)]

use std::fs;

use camino::Utf8PathBuf;
use seampact_cli_config::{CliProblem, LoadedAppConfig, ReadAppConfigOutcome, read_app_config};
use tempfile::TempDir;

const CONFIG_NAME: &str = "seampact.config.yaml";

/// Writes each `(relative path, text)` under a new temporary directory.
pub fn write_tree(files: &[(&str, &str)]) -> (TempDir, Utf8PathBuf) {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let root =
        Utf8PathBuf::from_path_buf(directory.path().canonicalize().expect("a canonical path"))
            .expect("a UTF-8 path");

    for (path, text) in files {
        let file = root.join(path);

        fs::create_dir_all(file.parent().expect("a parent")).expect("a directory");
        fs::write(file, text).expect("a file");
    }

    (directory, root)
}

/// Reads the app config of a one-file tree holding `text`.
pub fn read_text(text: &str) -> ReadAppConfigOutcome {
    let (_directory, root) = write_tree(&[(CONFIG_NAME, text)]);

    read_app_config(&root.join(CONFIG_NAME), CONFIG_NAME, None).expect("a readable tree")
}

/// Reads the app `app` of a tree, named `<app>/seampact.config.yaml`.
pub fn read_tree_app(root: &Utf8PathBuf, app: &str) -> ReadAppConfigOutcome {
    let name = format!("{app}/{CONFIG_NAME}");

    read_app_config(&root.join(&name), &name, None).expect("a readable tree")
}

pub fn read_config(outcome: ReadAppConfigOutcome) -> LoadedAppConfig {
    match outcome {
        ReadAppConfigOutcome::Read(config) => *config,
        ReadAppConfigOutcome::Refused(problems) => panic!("refused: {problems:?}"),
    }
}

pub fn refused(outcome: ReadAppConfigOutcome) -> Vec<CliProblem> {
    match outcome {
        ReadAppConfigOutcome::Refused(problems) => problems,
        ReadAppConfigOutcome::Read(config) => panic!("read: {config:?}"),
    }
}

pub const SERVER_ENTRY_HEAD: &str = "targets:\n  - id: server\n    use: x\n    api: a\n";
