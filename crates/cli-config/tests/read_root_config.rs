//! The root config reader on small config trees.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use camino::Utf8PathBuf;
use seampact_cli_config::{ReadRootConfigOutcome, ResolvedSource, read_root_config};
use seampact_json::JsonValue;
use support::write_tree;

const APP_CONFIG: &str = "sources:\n  own: { path: ./contracts }\n";

fn read_root(root_text: &str, apps: &[(&str, &str)]) -> (Utf8PathBuf, ReadRootConfigOutcome) {
    let mut files = vec![("seampact.config.yaml", root_text)];

    files.extend_from_slice(apps);

    let (directory, root) = write_tree(&files);
    let outcome = read_root_config(&root.join("seampact.config.yaml"), "seampact.config.yaml")
        .expect("a readable tree");

    drop(directory);

    (root, outcome)
}

fn refused_problems(outcome: ReadRootConfigOutcome) -> Vec<seampact_cli_config::CliProblem> {
    match outcome {
        ReadRootConfigOutcome::Refused(problems) => problems,
        ReadRootConfigOutcome::Read(config) => panic!("read: {config:?}"),
    }
}

#[test]
fn the_apps_sources_and_merged_documents_are_read() {
    let (root, outcome) = read_root(
        "apps: [apps/api, services/billing]\nallowLocal: false\nsources:\n  shared: { path: ./contracts }\nopenapi:\n  platform: { path: openapi/platform.yaml, prefix: { billing: billing }, extensions: none }\n  api: { path: openapi/api.yaml, apps: [apps/api] }\nchecks: { openapi: warning }\n",
        &[
            ("apps/api/seampact.config.yaml", APP_CONFIG),
            ("services/billing/seampact.config.yaml", APP_CONFIG),
        ],
    );
    let ReadRootConfigOutcome::Read(config) = outcome else {
        panic!("a valid root");
    };

    assert_eq!(config.display_name, "seampact.config.yaml");
    assert_eq!(
        config
            .apps
            .iter()
            .map(|app| app.name.as_str())
            .collect::<Vec<_>>(),
        ["apps/api", "services/billing"]
    );
    assert_eq!(
        config.apps[1].file,
        root.join("services/billing/seampact.config.yaml")
    );
    assert_eq!(
        config.sources.get("shared"),
        Some(&ResolvedSource::Path {
            directory: root.join("contracts")
        })
    );
    assert_eq!(config.allow_local, Some(false));
    assert_eq!(config.openapi[0].apps, ["apps/api", "services/billing"]);
    assert_eq!(config.openapi[0].file, root.join("openapi/platform.yaml"));
    assert_eq!(config.openapi[1].apps, ["apps/api"]);
    assert_eq!(
        config.openapi[1].options,
        JsonValue::Object(seampact_json::JsonObject::new())
    );
}

#[test]
fn the_keys_of_one_app_are_refused_with_their_positions() {
    let (_root, outcome) = read_root(
        "apps: [api]\noutDir: gen\ntargets: []\ndiff: { gate: both }\nchecks: { openapi: error, generated: error, matrix: warning }\n",
        &[("api/seampact.config.yaml", APP_CONFIG)],
    );
    let problems = refused_problems(outcome);
    let located: Vec<(&str, &str)> = problems
        .iter()
        .map(|problem| {
            (
                problem.code.as_str(),
                problem.location.as_deref().unwrap_or(""),
            )
        })
        .collect();

    assert_eq!(
        located,
        [
            ("config.root.app-key", "seampact.config.yaml:2:1 outDir"),
            ("config.root.app-key", "seampact.config.yaml:3:1 targets"),
            ("config.root.app-key", "seampact.config.yaml:4:1 diff"),
            (
                "config.root.app-key",
                "seampact.config.yaml:5:27 checks.generated"
            ),
            (
                "config.root.app-key",
                "seampact.config.yaml:5:45 checks.matrix"
            ),
        ]
    );
    assert!(problems[0].message.contains("belongs to one app"));
    assert!(problems[0].fix.contains("seampact.config.yaml"));
}

#[test]
fn an_app_directory_outside_the_root_the_root_itself_missing_or_twice_is_refused() {
    let (_root, outcome) = read_root(
        "apps: [../elsewhere, ., missing, api, ./api/]\n",
        &[("api/seampact.config.yaml", APP_CONFIG)],
    );
    let problems = refused_problems(outcome);

    assert_eq!(problems.len(), 4);
    assert!(
        problems[0].message.contains("not below")
            && problems[0].location.as_deref() == Some("seampact.config.yaml:1:8 apps[0]")
    );
    assert!(
        problems[1].message.contains("own directory")
            && problems[1].location.as_deref() == Some("seampact.config.yaml:1:22 apps[1]")
    );
    assert_eq!(
        (problems[2].code.as_str(), problems[2].location.as_deref()),
        (
            "config.apps.no-config",
            Some("seampact.config.yaml:1:25 apps[2]")
        )
    );
    assert_eq!(
        problems[3].message,
        "'./api/' and 'api' name the same app directory."
    );
}

#[test]
fn a_merged_document_covering_an_unlisted_app_is_refused_and_a_listed_spelling_is_resolved() {
    let apps = [("api/seampact.config.yaml", APP_CONFIG)];
    let (_root, outcome) = read_root(
        "apps: [api]\nopenapi:\n  all: { path: all.yaml, apps: [web] }\n",
        &apps,
    );
    let problems = refused_problems(outcome);

    assert_eq!(problems[0].code, "config.openapi.unknown-app");
    assert_eq!(
        problems[0].location.as_deref(),
        Some("seampact.config.yaml:3:33 openapi.all.apps[0]")
    );

    let (_root, outcome) = read_root(
        "apps: [api]\nopenapi:\n  all: { path: all.yaml, apps: [./api/] }\n",
        &apps,
    );
    let ReadRootConfigOutcome::Read(config) = outcome else {
        panic!("a valid root");
    };

    assert_eq!(config.openapi[0].apps, ["api"]);
}
