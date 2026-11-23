//! `select_artefacts` on the cases of the TypeScript `artefact-switches.test.ts`.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::type_complexity,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use seampact_cli_config::{ArtefactSelection, select_artefacts};
use seampact_target::ArtefactDeclaration;
use serde_json::{Value, json};
use support::{artefact, entry_of, stub_target};

const DECLARED: &[ArtefactDeclaration] = &[
    artefact("types", true, &[], false),
    artefact("routes", true, &["types"], false),
    artefact("nativeDocs", false, &[], false),
];

fn select(artefacts: Option<Value>, declared: &'static [ArtefactDeclaration]) -> ArtefactSelection {
    let mut entry = json!({ "id": "server", "use": "@acme/codegen-server", "api": "tasks" });

    if let Some(artefacts) = artefacts {
        entry["artefacts"] = artefacts;
    }

    select_artefacts(&entry_of(entry), stub_target(declared, None)).expect("a selection")
}

fn selected(selection: &ArtefactSelection) -> Vec<&str> {
    match selection {
        ArtefactSelection::Selected(artefacts) => artefacts.iter().collect(),
        ArtefactSelection::Refused(problems) => panic!("refused: {problems:?}"),
    }
}

fn refused_codes(selection: &ArtefactSelection) -> Vec<&str> {
    match selection {
        ArtefactSelection::Refused(problems) => problems
            .iter()
            .map(|problem| problem.code.as_str())
            .collect(),
        ArtefactSelection::Selected(_) => panic!("selected"),
    }
}

#[test]
fn the_declared_defaults_apply_with_native_docs_off() {
    assert_eq!(selected(&select(None, DECLARED)), ["types", "routes"]);
}

#[test]
fn native_docs_switches_on_and_an_artefact_nothing_needs_off() {
    let selection = select(
        Some(json!({ "nativeDocs": true, "routes": false })),
        DECLARED,
    );

    assert_eq!(selected(&selection), ["types", "nativeDocs"]);
}

#[test]
fn a_target_declaring_native_docs_on_keeps_it() {
    const ON: &[ArtefactDeclaration] = &[artefact("nativeDocs", true, &[], false)];

    assert_eq!(selected(&select(None, ON)), ["nativeDocs"]);
}

#[test]
fn the_boot_check_object_form_leaves_defaults_and_false_switches_it_off() {
    const BOOT: &[ArtefactDeclaration] = &[
        artefact("boundary", true, &[], false),
        artefact("bootCheck", true, &[], false),
    ];
    let object = select(
        Some(json!({ "bootCheck": { "frameworkRoutes": false } })),
        BOOT,
    );
    let off = select(Some(json!({ "bootCheck": false })), BOOT);

    assert_eq!(selected(&object), ["boundary", "bootCheck"]);
    assert_eq!(selected(&off), ["boundary"]);
}

#[test]
fn a_target_with_tunable_boot_checks_takes_the_boot_check_as_a_boolean() {
    use seampact_gen_probe::PROBE_SERVER;
    use seampact_target::Generator;

    assert_ne!(PROBE_SERVER.metadata().boot_checks.len(), 0);

    for flag in [false, true] {
        let entry = entry_of(json!({
            "id": "server", "use": "probe-server", "api": "tasks",
            "artefacts": { "bootCheck": flag }
        }));
        let selection = select_artefacts(&entry, &PROBE_SERVER).expect("a selection");

        assert_eq!(selected(&selection), ["routes"], "bootCheck {flag}");
    }
}

#[test]
fn the_boot_check_boolean_is_refused_for_a_target_with_no_boot_check() {
    const BOUNDARY: &[ArtefactDeclaration] = &[artefact("boundary", true, &[], false)];

    let selection = select(Some(json!({ "bootCheck": false })), BOUNDARY);

    assert_eq!(refused_codes(&selection), ["config.artefacts.unknown"]);
}

#[test]
fn an_undeclared_switch_names_the_declared_artefacts() {
    let ArtefactSelection::Refused(problems) = select(Some(json!({ "client": false })), DECLARED)
    else {
        panic!("selected");
    };
    let [problem] = problems.as_slice() else {
        panic!("{problems:?}");
    };

    assert_eq!(
        problem.message,
        "The target '@acme/codegen-server' declares no artefact 'client'; it declares 'types', 'routes', 'nativeDocs'."
    );
    assert_eq!(
        problem.fix,
        "Remove 'client' from the entry's `artefacts`, or switch one of the artefacts the target declares."
    );
    assert_eq!(problem.location.as_deref(), Some("entry 'server'"));
}

#[test]
fn an_undeclared_native_docs_points_at_the_seampact_document() {
    const BOUNDARY: &[ArtefactDeclaration] = &[artefact("boundary", true, &[], false)];
    let ArtefactSelection::Refused(problems) =
        select(Some(json!({ "nativeDocs": true })), BOUNDARY)
    else {
        panic!("selected");
    };

    assert!(
        problems
            .iter()
            .all(|problem| problem.fix.contains("`openapi/<api>.yaml`"))
    );
}

#[test]
fn switching_off_a_needed_artefact_names_both() {
    let ArtefactSelection::Refused(problems) = select(Some(json!({ "types": false })), DECLARED)
    else {
        panic!("selected");
    };
    let [problem] = problems.as_slice() else {
        panic!("{problems:?}");
    };

    assert_eq!(problem.code, "config.artefacts.needed");
    assert_eq!(
        problem.message,
        "The artefact 'routes' of the target '@acme/codegen-server' needs 'types', which the entry leaves off."
    );
    assert_eq!(
        problem.fix,
        "Switch 'types' on, or switch 'routes' off too."
    );
}

#[test]
fn an_entry_with_every_artefact_off_is_refused() {
    let ArtefactSelection::Refused(problems) =
        select(Some(json!({ "types": false, "routes": false })), DECLARED)
    else {
        panic!("selected");
    };
    let [problem] = problems.as_slice() else {
        panic!("{problems:?}");
    };

    assert_eq!(problem.code, "config.artefacts.none");
    assert_eq!(
        problem.message,
        "The entry leaves off every artefact the target '@acme/codegen-server' declares ('types', 'routes', 'nativeDocs'), so it would generate nothing."
    );
}

#[test]
fn an_artefact_that_follows_its_needs_goes_with_them_unless_written_on() {
    const FOLLOWING: &[ArtefactDeclaration] = &[
        artefact("boundary", true, &[], false),
        artefact("validators", true, &[], false),
        artefact("index", true, &["boundary"], true),
    ];

    assert_eq!(
        selected(&select(Some(json!({ "boundary": false })), FOLLOWING)),
        ["validators"]
    );
    assert_eq!(
        refused_codes(&select(
            Some(json!({ "boundary": false, "index": true })),
            FOLLOWING
        )),
        ["config.artefacts.needed"]
    );
}
