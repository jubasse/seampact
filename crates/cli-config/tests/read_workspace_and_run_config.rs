//! The workspace and run config readers on small config trees.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use seampact_cli_config::{
    CliProblem, ReadRunConfigOutcome, ReadWorkspaceOutcome, ResolvedSource, RunConfig,
    read_run_config, read_workspace_configs,
};
use support::write_tree;

const APP_CONFIG: &str = "sources:\n  own: { path: ./contracts }\n";
const CONFIG_NAME: &str = "seampact.config.yaml";

fn refused(outcome: ReadWorkspaceOutcome) -> Vec<CliProblem> {
    match outcome {
        ReadWorkspaceOutcome::Refused(problems) => problems,
        ReadWorkspaceOutcome::Read(workspace) => panic!("read: {workspace:?}"),
    }
}

#[test]
fn every_app_of_a_workspace_is_read_with_the_root_folded_in() {
    let (_directory, root) = write_tree(&[
        (
            CONFIG_NAME,
            "apps: [api]\nsources:\n  shared: { path: ./contracts }\n",
        ),
        ("api/seampact.config.yaml", APP_CONFIG),
    ]);
    let outcome = read_workspace_configs(&root.join(CONFIG_NAME), CONFIG_NAME).expect("readable");
    let ReadWorkspaceOutcome::Read(workspace) = outcome else {
        panic!("a valid workspace");
    };
    let app = &workspace.apps[0];

    assert_eq!(app.app.name, "api");
    assert_eq!(app.config.root_file, Some(root.join(CONFIG_NAME)));
    assert_eq!(
        app.config
            .sources
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["shared", "own"]
    );
    assert_eq!(
        app.config.sources.get("own"),
        Some(&ResolvedSource::Path {
            directory: root.join("api/contracts")
        })
    );
}

#[test]
fn the_problems_of_every_app_are_reported_together_under_the_roots_directory() {
    let (_directory, root) = write_tree(&[
        ("sub/seampact.config.yaml", "apps: [api, web, docs]\n"),
        ("sub/api/seampact.config.yaml", APP_CONFIG),
        ("sub/web/seampact.config.yaml", "outDir: 3\n"),
        ("sub/docs/seampact.config.yaml", "outDir: 4\n"),
    ]);
    let problems = refused(
        read_workspace_configs(
            &root.join("sub").join(CONFIG_NAME),
            "sub/seampact.config.yaml",
        )
        .expect("readable"),
    );
    let places: Vec<Option<&str>> = problems
        .iter()
        .map(|problem| problem.location.as_deref())
        .collect();

    assert_eq!(
        places,
        [
            Some("sub/web/seampact.config.yaml:1:1 outDir"),
            Some("sub/docs/seampact.config.yaml:1:1 outDir"),
        ]
    );
}

#[test]
fn a_refused_root_stops_the_workspace_before_any_app() {
    let (_directory, root) = write_tree(&[(CONFIG_NAME, "apps: []\n")]);
    let problems =
        refused(read_workspace_configs(&root.join(CONFIG_NAME), CONFIG_NAME).expect("readable"));

    assert_ne!(problems, [] as [seampact_cli_config::CliProblem; 0]);
}

#[test]
fn a_file_holding_apps_is_a_root_and_any_other_an_app() {
    let (_directory, root) = write_tree(&[
        ("root/seampact.config.yaml", "apps: [api]\n"),
        ("root/api/seampact.config.yaml", APP_CONFIG),
        ("alone/seampact.config.yaml", APP_CONFIG),
    ]);
    let root_run =
        read_run_config(&root.join("root").join(CONFIG_NAME), CONFIG_NAME, None).expect("readable");
    let app_run = read_run_config(&root.join("alone").join(CONFIG_NAME), CONFIG_NAME, None)
        .expect("readable");

    assert!(
        matches!(root_run, ReadRunConfigOutcome::Read(RunConfig::Root(_))),
        "{root_run:?}"
    );
    assert!(
        matches!(app_run, ReadRunConfigOutcome::Read(RunConfig::App(_))),
        "{app_run:?}"
    );
}

#[test]
fn a_root_config_read_through_an_app_directory_text_file_is_refused() {
    let (_directory, root) = write_tree(&[(CONFIG_NAME, "apps: [api]\n")]);
    let file = root.join(CONFIG_NAME);
    let outcome = read_run_config(&file, "seampact.config.yaml", Some(&file)).expect("readable");
    let ReadRunConfigOutcome::Refused(problems) = outcome else {
        panic!("a refused root");
    };

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, "cli.app-directory.root");
    assert_eq!(problems[0].location, None);
    assert_eq!(
        problems[0].message,
        "seampact.config.yaml is a monorepo root config, and `--app-directory` reads one app's config."
    );
}

#[test]
fn a_file_that_does_not_parse_is_refused_as_an_app_config() {
    let (_directory, root) = write_tree(&[(CONFIG_NAME, "a: [\n")]);
    let outcome = read_run_config(&root.join(CONFIG_NAME), CONFIG_NAME, None).expect("readable");

    assert!(
        matches!(outcome, ReadRunConfigOutcome::Refused(_)),
        "{outcome:?}"
    );
}
