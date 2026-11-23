//! `check_compatibility` and `check_app_compatibility` on the cases of the TypeScript
//! `compatibility-check.test.ts`, on a matrix of its own: no probe has a matrix record.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::type_complexity,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::{
    AppConfigEntry, CompatibilityInput, CompatibilityOutcome, InstalledVersion, LoadedAppConfig,
    MatrixCheckLevel, check_app_compatibility, check_compatibility,
};
use seampact_json::JsonValue;
use seampact_target::{
    ArtefactDeclaration, CompatibilityKey, CompatibilityMatrix, FrameworkSupport,
    IncompatibleMajor, LibrarySupport, OwnValidator, TargetCompatibility, TestedMajor,
};
use serde_json::{Value, json};
use support::{artefact, entry_of, stub_target, write_tree};

const SERVER_PACKAGE: &str = "@acme/codegen-server";
const WHERE: &str = "entry 'server'";

fn record(tested: &[u32]) -> TargetCompatibility {
    TargetCompatibility {
        package: SERVER_PACKAGE.to_owned(),
        framework: FrameworkSupport {
            id: "web".to_owned(),
            package: "web-framework".to_owned(),
            tested: tested
                .iter()
                .map(|major| TestedMajor {
                    major: *major,
                    consumer: format!("web{major}"),
                })
                .collect(),
            incompatible: vec![IncompatibleMajor {
                major: 3,
                reason: "its router has no route listing.".to_owned(),
            }],
            floor: None,
        },
        libraries: None,
        validator_styles: vec![],
        own_validators: vec![],
        client_styles: vec![],
    }
}

fn matrix_of(record: TargetCompatibility) -> CompatibilityMatrix {
    CompatibilityMatrix {
        first_party_providers: vec![],
        server_targets: vec![record],
        client_targets: vec![],
        jvm_targets: vec![],
        php_targets: vec![],
        python_targets: vec![],
    }
}

const BOUNDARY: &[ArtefactDeclaration] = &[artefact("boundary", true, &[], false)];

const SERVER_KEY: CompatibilityKey = CompatibilityKey::Server(SERVER_PACKAGE);

struct Case {
    installed_major: u64,
    installed_version: Option<&'static str>,
    allow_untested: Vec<&'static str>,
    level: MatrixCheckLevel,
    recorded: bool,
    matrix: CompatibilityMatrix,
}

fn case(installed_major: u64) -> Case {
    Case {
        installed_major,
        installed_version: None,
        allow_untested: vec![],
        level: MatrixCheckLevel::Warning,
        recorded: true,
        matrix: matrix_of(record(&[4, 5])),
    }
}

fn check(case: &Case) -> CompatibilityOutcome {
    let mut entry = json!({ "id": "server", "use": SERVER_PACKAGE, "api": "tasks" });

    if !case.allow_untested.is_empty() || !case.recorded {
        entry["allowUntested"] = json!(case.allow_untested);
    }

    let entry = entry_of(entry);
    let target = stub_target(BOUNDARY, case.recorded.then_some(SERVER_KEY));
    let targets = IndexMap::from([("server".to_owned(), target)]);
    let version = case
        .installed_version
        .map_or_else(|| format!("{}.1.0", case.installed_major), str::to_owned);
    let installed = IndexMap::from([(
        "server".to_owned(),
        InstalledVersion {
            package_name: "web-framework".to_owned(),
            version,
            major: case.installed_major,
        },
    )]);

    check_compatibility(&CompatibilityInput {
        entries: &[entry],
        targets: &targets,
        installed_versions: &installed,
        installed_libraries: &IndexMap::new(),
        matrix: &case.matrix,
        level: case.level,
    })
    .expect("an outcome")
}

fn untested() -> seampact_cli_config::CliProblem {
    seampact_cli_config::located_problem(
        "config.matrix.untested",
        "web-framework 6.1.0 is installed, and the target '@acme/codegen-server' is tested on web 4, 5 only.".to_owned(),
        "Install a tested major, or accept this one with `allowUntested: [web@6]` on the entry.",
        WHERE.to_owned(),
    )
}

#[test]
fn a_tested_major_passes() {
    assert_eq!(check(&case(5)), CompatibilityOutcome::default());
}

#[test]
fn an_untested_major_warns_naming_the_tested_ones_or_none() {
    assert_eq!(check(&case(6)).warnings, [untested()]);

    let mut none_tested = case(6);

    none_tested.matrix = matrix_of(record(&[]));

    assert_eq!(
        check(&none_tested).warnings[0].message,
        "web-framework 6.1.0 is installed, and the target '@acme/codegen-server' is tested on no web major yet."
    );
}

#[test]
fn an_untested_major_is_refused_under_the_error_level() {
    let mut strict = case(6);

    strict.level = MatrixCheckLevel::Error;

    let outcome = check(&strict);

    assert_eq!(outcome.problems, [untested()]);
    assert_eq!(outcome.warnings, []);

    strict.allow_untested = vec!["web@6"];

    assert_eq!(check(&strict), CompatibilityOutcome::default());
}

#[test]
fn a_zero_major_is_accepted_by_its_minor_only() {
    let mut zero = case(0);

    zero.installed_version = Some("0.162.3");
    zero.allow_untested = vec!["web@0.162"];

    assert_eq!(check(&zero), CompatibilityOutcome::default());

    zero.allow_untested = vec!["web@0.161"];

    assert!(check(&zero).warnings[0].fix.contains("[web@0.162]"));

    zero.installed_version = Some("0");
    zero.allow_untested = vec![];

    assert!(check(&zero).warnings[0].fix.contains("[web@0.<minor>]"));
}

#[test]
fn an_incompatible_major_is_refused_with_or_without_allow_untested() {
    let message = "web-framework 3.1.0 is installed, and the target '@acme/codegen-server' does not work on web 3: its router has no route listing.";
    let fix = "Install a major of web-framework the target is tested on: 4, 5.";
    let mut incompatible = case(3);

    for allowed in [vec![], vec!["web@3"]] {
        incompatible.allow_untested = allowed;

        let outcome = check(&incompatible);

        assert_eq!(outcome.problems.len(), 1);
        assert_eq!(outcome.problems[0].code, "config.matrix.incompatible");
        assert_eq!(outcome.problems[0].message, message);
        assert_eq!(outcome.problems[0].fix, fix);
        assert_eq!(outcome.warnings, []);
    }
}

#[test]
fn an_item_naming_another_framework_is_refused() {
    let mut other = case(5);

    other.allow_untested = vec!["express@6"];

    let outcome = check(&other);

    assert_eq!(outcome.problems[0].code, "config.matrix.unknown-framework");
    assert_eq!(
        outcome.problems[0].message,
        "The `allowUntested` item 'express@6' names the framework 'express', and the target '@acme/codegen-server' serves 'web'."
    );
    assert_eq!(
        outcome.problems[0].fix,
        "Write the item as 'web@<major>', or remove it."
    );
}

#[test]
fn an_item_naming_a_tested_major_warns_that_it_can_go() {
    let mut tested = case(5);

    tested.allow_untested = vec!["web@4"];

    let outcome = check(&tested);

    assert_eq!(outcome.problems, []);
    assert_eq!(outcome.warnings[0].code, "config.matrix.allowed-tested");
    assert_eq!(
        outcome.warnings[0].fix,
        "Remove 'web@4' from the entry's `allowUntested`."
    );
}

#[test]
fn a_target_the_matrix_does_not_record_checks_nothing_and_refuses_allow_untested() {
    let mut unrecorded = case(6);

    unrecorded.recorded = false;

    assert_eq!(check(&unrecorded), CompatibilityOutcome::default());

    unrecorded.allow_untested = vec!["web@6"];

    let outcome = check(&unrecorded);

    assert_eq!(outcome.problems[0].code, "config.matrix.unrecorded-target");
    assert_eq!(
        outcome.problems[0].fix,
        "Remove `allowUntested` from the entry."
    );
}

#[test]
fn an_item_without_an_at_sign_loses_its_last_character_as_slice_does() {
    let mut odd = case(5);

    odd.allow_untested = vec!["xyz"];

    assert!(
        check(&odd).problems[0]
            .message
            .contains("names the framework 'xy'")
    );
}

// The app level: versions are read from the entry's output directory.

fn app_config(root: &Utf8PathBuf, entry: &Value, matrix_level: &str) -> LoadedAppConfig {
    LoadedAppConfig {
        file: root.join("app/seampact.config.yaml"),
        out_dir: root.join("app"),
        allow_local: None,
        sources: IndexMap::new(),
        entries: vec![AppConfigEntry {
            entry: JsonValue::try_from(entry.clone()).expect("a JSON value"),
            root: root.join("app/src/generated"),
        }],
        openapi: None,
        checks: Some(JsonValue::try_from(json!({ "matrix": matrix_level })).expect("a JSON value")),
        diff: None,
        warnings: None,
        root_file: None,
    }
}

fn app_check(
    files: &[(&str, &str)],
    entry: &Value,
    artefacts: &'static [ArtefactDeclaration],
    record: TargetCompatibility,
) -> CompatibilityOutcome {
    let (_directory, root) = write_tree(files);
    let targets = IndexMap::from([(
        "server".to_owned(),
        stub_target(artefacts, Some(SERVER_KEY)),
    )]);

    check_app_compatibility(
        &app_config(&root, entry, "error"),
        &targets,
        &matrix_of(record),
    )
    .expect("an outcome")
}

fn framework_files<'text>(extra: &[(&'text str, &'text str)]) -> Vec<(&'text str, &'text str)> {
    let mut files = vec![
        ("app/seampact.config.yaml", ""),
        (
            "app/node_modules/web-framework/package.json",
            r#"{"version":"5.0.0"}"#,
        ),
    ];

    files.extend_from_slice(extra);

    files
}

fn entry_json() -> Value {
    json!({ "id": "server", "use": SERVER_PACKAGE, "api": "tasks" })
}

#[test]
fn the_framework_is_read_from_the_output_directory_project() {
    let (_directory, root) = write_tree(&[
        ("app/seampact.config.yaml", ""),
        (
            "app/node_modules/web-framework/package.json",
            r#"{"version":"3.0.0"}"#,
        ),
        (
            "server/node_modules/web-framework/package.json",
            r#"{"version":"5.0.0"}"#,
        ),
    ]);
    let mut config = app_config(&root, &entry_json(), "error");

    config.entries[0].root = root.join("server/src/generated");

    let targets = IndexMap::from([("server".to_owned(), stub_target(BOUNDARY, Some(SERVER_KEY)))]);

    assert_eq!(
        check_app_compatibility(&config, &targets, &matrix_of(record(&[4, 5])))
            .expect("an outcome"),
        CompatibilityOutcome::default()
    );
}

fn docs_record() -> TargetCompatibility {
    TargetCompatibility {
        libraries: Some(vec![LibrarySupport {
            id: "web-docs".to_owned(),
            package: "web-docs-library".to_owned(),
            artefact: "nativeDocs".to_owned(),
            tested_majors: vec![2],
            selected_by: None,
        }]),
        ..record(&[4, 5])
    }
}

const DOCS_ARTEFACTS: &[ArtefactDeclaration] = &[
    artefact("boundary", true, &[], false),
    artefact("nativeDocs", false, &["boundary"], false),
];

#[test]
fn the_docs_library_is_checked_when_its_artefact_is_on_and_accepted_in_allow_untested() {
    let files = framework_files(&[(
        "app/node_modules/web-docs-library/package.json",
        r#"{"version":"3.0.0"}"#,
    )]);
    let mut entry = entry_json();

    entry["artefacts"] = json!({ "nativeDocs": true });

    let outcome = app_check(&files, &entry, DOCS_ARTEFACTS, docs_record());

    assert_eq!(outcome.problems.len(), 1);
    assert_eq!(
        outcome.problems[0].message,
        "web-docs-library 3.0.0 is installed, and the target '@acme/codegen-server' is tested on web-docs 2 only."
    );
    assert_eq!(
        outcome.problems[0].fix,
        "Install a tested major, or accept this one with `allowUntested: [web-docs@3]` on the entry."
    );

    entry["allowUntested"] = json!(["web-docs@3"]);

    assert_eq!(
        app_check(&files, &entry, DOCS_ARTEFACTS, docs_record()),
        CompatibilityOutcome::default()
    );
}

#[test]
fn no_docs_library_is_read_while_its_artefact_is_off() {
    assert_eq!(
        app_check(
            &framework_files(&[]),
            &entry_json(),
            DOCS_ARTEFACTS,
            docs_record()
        ),
        CompatibilityOutcome::default()
    );
}

#[test]
fn a_docs_library_that_is_not_installed_is_refused_with_its_install_command() {
    let mut entry = entry_json();

    entry["artefacts"] = json!({ "nativeDocs": true });

    let outcome = app_check(&framework_files(&[]), &entry, DOCS_ARTEFACTS, docs_record());

    assert_eq!(outcome.problems.len(), 1);
    assert_eq!(outcome.problems[0].code, "config.matrix.framework-missing");
    assert!(outcome.problems[0].fix.contains("web-docs-library"));
}

fn own_validators_record() -> TargetCompatibility {
    TargetCompatibility {
        own_validators: vec![OwnValidator {
            id: "own".to_owned(),
            library: "own-validators-library".to_owned(),
        }],
        ..record(&[4, 5])
    }
}

const OWN_ARTEFACTS: &[ArtefactDeclaration] = &[
    artefact("boundary", true, &[], false),
    artefact("validators", true, &[], false),
];

#[test]
fn an_own_validators_library_that_is_not_installed_is_refused() {
    let missing = app_check(
        &framework_files(&[]),
        &entry_json(),
        OWN_ARTEFACTS,
        own_validators_record(),
    );

    assert_eq!(missing.problems.len(), 1);
    assert_eq!(
        missing.problems[0].code,
        "config.own-validators.library-missing"
    );
    assert!(missing.problems[0].fix.contains("own-validators-library"));

    let installed = framework_files(&[(
        "app/node_modules/own-validators-library/package.json",
        r#"{"version":"8.0.0"}"#,
    )]);

    assert_eq!(
        app_check(
            &installed,
            &entry_json(),
            OWN_ARTEFACTS,
            own_validators_record()
        ),
        CompatibilityOutcome::default()
    );
}

#[test]
fn no_own_validators_library_is_read_when_the_entry_links_a_provider() {
    let mut entry = entry_json();

    entry["link"] = json!({ "validators": "zod" });

    assert_eq!(
        app_check(
            &framework_files(&[]),
            &entry,
            OWN_ARTEFACTS,
            own_validators_record()
        ),
        CompatibilityOutcome::default()
    );
}

#[test]
fn only_the_library_the_selecting_option_names_is_read() {
    use seampact_target::LibrarySelector;

    let record = TargetCompatibility {
        libraries: Some(vec![
            LibrarySupport {
                id: "swr".to_owned(),
                package: "swr".to_owned(),
                artefact: "boundary".to_owned(),
                tested_majors: vec![2],
                selected_by: Some(LibrarySelector {
                    option: "query".to_owned(),
                    value: "swr".to_owned(),
                }),
            },
            LibrarySupport {
                id: "tanstack".to_owned(),
                package: "@tanstack/react-query".to_owned(),
                artefact: "boundary".to_owned(),
                tested_majors: vec![5],
                selected_by: Some(LibrarySelector {
                    option: "query".to_owned(),
                    value: "tanstack".to_owned(),
                }),
            },
        ]),
        ..record(&[4, 5])
    };
    let files = framework_files(&[(
        "app/node_modules/swr/package.json",
        r#"{"version":"2.3.0"}"#,
    )]);
    let mut entry = entry_json();

    entry["options"] = json!({ "query": "swr" });

    assert_eq!(
        app_check(&files, &entry, BOUNDARY, record.clone()),
        CompatibilityOutcome::default()
    );

    entry["options"] = json!({ "query": "tanstack" });

    let outcome = app_check(&files, &entry, BOUNDARY, record);

    assert_eq!(outcome.problems.len(), 1);
    assert_eq!(outcome.problems[0].code, "config.matrix.framework-missing");
    assert!(
        outcome.problems[0]
            .message
            .contains("The library '@tanstack/react-query'")
    );
}
