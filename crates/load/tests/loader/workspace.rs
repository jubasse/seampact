//! The entry file: a workspace or one api, the config it passes through, the paths written in an
//! included file and the fragments the includes bring.

use seampact_authoring::JsonObjectExt;
use seampact_diagnostics::DiagnosticLayer;
use seampact_json::JsonValue;
use seampact_load::{FsReader, MemoryReader};

use super::harness::{fixture_directory, run, run_entry, run_on};

fn kinds_of(
    files: &[(&str, &str)],
    entry: &str,
) -> Vec<(String, Option<String>, Option<&'static str>)> {
    let load = run_entry(files, entry);

    load.assert_clean();

    load.output
        .fragments
        .iter()
        .map(|fragment| {
            (
                fragment.file.clone(),
                fragment.pointer.clone(),
                fragment.kind,
            )
        })
        .collect()
}

#[test]
fn workspace_apis_and_shared_written_in_an_included_file_resolve_against_it() {
    let load = run_entry(
        &[
            ("workspace.yaml", "$include: ./sub/ws.yaml\n"),
            (
                "sub/ws.yaml",
                "workspace:\n  apis:\n    a: ./a.yaml\n  shared: ./shared.yaml\n",
            ),
            ("sub/a.yaml", "api: { name: a, version: 1 }\n"),
            ("sub/shared.yaml", "scalars:\n  Id: { type: string }\n"),
        ],
        "workspace.yaml",
    );

    load.assert_clean();
    assert_eq!(
        load.layers(0),
        [
            ("shared".to_owned(), "sub/shared.yaml".to_owned()),
            ("api".to_owned(), "sub/a.yaml".to_owned())
        ]
    );
}

#[test]
fn extends_packs_and_pack_extends_written_in_an_included_file_resolve_against_it() {
    let load = run(&[
        ("api.yaml", "$include: ./parts/head.yaml\n"),
        (
            "parts/head.yaml",
            "api: { name: a, version: 1 }\nextends: ./base.yaml\npacks: [./packs/p.yaml]\n",
        ),
        ("parts/base.yaml", "scalars:\n  Id: { type: string }\n"),
        ("parts/packs/p.yaml", "$include: ./m/manifest.yaml\n"),
        (
            "parts/packs/m/manifest.yaml",
            "pack: { name: p, version: 1.0.0, extends: [./q.yaml] }\n",
        ),
        (
            "parts/packs/m/q.yaml",
            "pack: { name: q, version: 1.0.0 }\n",
        ),
    ]);

    load.assert_clean();
    assert_eq!(
        load.layers(0),
        [
            ("pack:q".to_owned(), "parts/packs/m/q.yaml".to_owned()),
            ("pack:p".to_owned(), "parts/packs/p.yaml".to_owned()),
            ("base".to_owned(), "parts/base.yaml".to_owned()),
            ("api".to_owned(), "api.yaml".to_owned()),
        ]
    );
}

#[test]
fn the_reference_workspaces_fragments_are_two_schema_catalogues_and_a_tree_node() {
    let directory = fixture_directory("../reference");
    let reader = FsReader::new(&directory).expect("the reference workspace");
    let load = run_on(&reader, "workspace.yaml");
    let fragments: Vec<(&str, Option<&str>, &str)> = load
        .output
        .fragments
        .iter()
        .map(|fragment| {
            (
                fragment.file.as_str(),
                fragment.kind,
                fragment.at.file.as_str(),
            )
        })
        .collect();

    assert_eq!(
        fragments,
        [
            ("shared/schemas.yaml", Some("schemas"), "shared/base.yaml"),
            (
                "tasks/routes/tasks/search.yaml",
                Some("node"),
                "tasks/api.yaml"
            ),
            ("tasks/schemas.yaml", Some("schemas"), "tasks/api.yaml"),
        ]
    );
}

#[test]
fn each_include_site_gives_its_own_kind() {
    let kinds = kinds_of(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis:\n    a: ./api.yaml\n  shared: ./base.yaml\n",
            ),
            ("base.yaml", "$include: ./base-part.yaml\n"),
            ("base-part.yaml", "scalars: { Id: { type: string } }\n"),
            (
                "api.yaml",
                "api: { name: a, version: 1 }\nrights: { $include: ./rights.yaml }\nconventions: { $include: ./conventions.yaml }\nschemas:\n  Task: { $include: ./task.yaml }\nsurfaces:\n  public:\n    routes:\n      tasks:\n        method: get\n        output: { $ref: ./shared.yaml#/Note }\n        errors: { $include: ./errors.yaml }\n",
            ),
            ("rights.yaml", "tasks.read: {}\n"),
            ("conventions.yaml", "pathVersion: none\n"),
            ("task.yaml", "type: object\n"),
            ("shared.yaml", "Note: { type: string }\n"),
            ("errors.yaml", "{}\n"),
        ],
        "workspace.yaml",
    );
    let expected: Vec<(String, Option<String>, Option<&str>)> = vec![
        ("base-part.yaml".to_owned(), None, Some("base")),
        ("conventions.yaml".to_owned(), None, Some("conventions")),
        ("errors.yaml".to_owned(), None, Some("node-errors")),
        ("rights.yaml".to_owned(), None, Some("rights")),
        (
            "shared.yaml".to_owned(),
            Some("/Note".to_owned()),
            Some("schemas"),
        ),
        ("task.yaml".to_owned(), None, Some("schema")),
    ];

    assert_eq!(kinds, expected);
}

#[test]
fn an_include_at_the_root_of_an_entry_names_no_kind() {
    let kinds = kinds_of(
        &[
            ("workspace.yaml", "$include: ./ws.yaml\n"),
            ("ws.yaml", "workspace:\n  apis:\n    a: ./a.yaml\n"),
            ("a.yaml", "api: { name: a, version: 1 }\n"),
        ],
        "workspace.yaml",
    );

    assert_eq!(kinds, [("ws.yaml".to_owned(), None, None)]);
}

#[test]
fn what_an_entry_read_as_both_kinds_reported_moves_to_the_layer_its_includes_give() {
    let load = run(&[
        ("api.yaml", "$include: ./a.yaml\n"),
        ("a.yaml", "api: { name: t }\nflag: yes\n"),
    ]);
    let workspace = run_entry(
        &[
            ("workspace.yaml", "$include: ./w.yaml\n"),
            ("w.yaml", "workspace:\n  apis: { a: ./a.yaml }\nflag: yes\n"),
            ("a.yaml", "api: { name: a }\n"),
        ],
        "workspace.yaml",
    );

    assert_eq!(load.rules(), ["yaml-boolean"]);
    assert_eq!(load.diagnostic(0).origin.layer, DiagnosticLayer::Api);
    assert_eq!(workspace.rules(), ["yaml-boolean"]);
    assert_eq!(
        workspace.diagnostic(0).origin.layer,
        DiagnosticLayer::Workspace
    );
}

#[test]
fn the_entry_shapes_are_each_refused_with_their_message() {
    let cases: [(&[(&str, &str)], &str); 5] = [
        (
            &[(
                "api.yaml",
                "workspace: { apis: { a: ./a.yaml } }\napi: { name: a }\n",
            )],
            "the entry file is both a workspace (workspace:) and an api (api:)",
        ),
        (
            &[("api.yaml", "api: { version: 1 }\n")],
            "the api file has no api.name",
        ),
        (
            &[("api.yaml", "schemas: {}\n")],
            "the entry file is neither a workspace (workspace:) nor an api (api:)",
        ),
        (
            &[("api.yaml", "workspace: { apis: {} }\n")],
            "workspace.apis maps no api",
        ),
        (
            &[("api.yaml", "workspace: { apis: { a: 3 } }\n")],
            "workspace.apis.a takes a path",
        ),
    ];

    for (files, message) in cases {
        let load = run(files);

        let reported: Vec<&str> = load
            .output
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.rule.as_str() == "seampact/load/workspace-shape")
            .map(|diagnostic| diagnostic.message.as_str())
            .collect();

        assert_eq!(reported, [message]);
    }
}

#[test]
fn a_workspace_holding_no_mapping_reports_nothing_in_the_loader_beyond_the_schema() {
    let load = run(&[("workspace.yaml", "workspace: yes please\n")]);
    let named = run_entry(
        &[("workspace.yaml", "workspace: yes please\n")],
        "workspace.yaml",
    );

    assert!(!load.rules().contains(&"workspace-shape"));
    assert!(!named.rules().contains(&"workspace-shape"));
    assert_eq!(named.output.workspace.apis.len(), 0);
}

#[test]
fn the_workspace_config_is_passed_through_unread() {
    let with = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  editorSchemas: ./schemas\n  imports: { x: [1, 2] }\n  apis: { a: ./a.yaml }\n",
            ),
            ("a.yaml", "api: { name: a }\n"),
        ],
        "workspace.yaml",
    );
    let without = run_entry(
        &[
            ("workspace.yaml", "workspace:\n  apis: { a: ./a.yaml }\n"),
            ("a.yaml", "api: { name: a }\n"),
        ],
        "workspace.yaml",
    );
    let config = with.output.workspace.config.as_ref().expect("a config");
    let imports = config.imports.as_ref().expect("imports");

    assert_eq!(config.editor_schemas.as_deref(), Some("./schemas"));
    assert_eq!(
        serde_json::to_value(imports).expect("a value"),
        serde_json::json!({ "x": [1, 2] })
    );
    assert!(without.output.workspace.config.is_none());
}

#[test]
fn only_a_workspace_entry_is_kept_whole_and_located_by_workspace_keys() {
    let workspace = run_entry(
        &[
            ("workspace.yaml", "workspace:\n  apis: { a: ./a.yaml }\n"),
            ("a.yaml", "api: { name: a }\n"),
        ],
        "workspace.yaml",
    );
    let single = run(&[("api.yaml", "api: { name: a }\n")]);
    let entry = workspace.output.workspace.entry.as_ref().expect("an entry");
    let span = workspace
        .output
        .workspace
        .locations
        .get("workspace#/workspace/apis/a")
        .expect("the pointer is located");
    let at = workspace.output.files.location(*span).expect("a location");

    assert_eq!(entry.file, "workspace.yaml");
    assert!(entry.tree.object("workspace").is_some());
    assert_eq!((at.file.as_str(), at.line), ("workspace.yaml", 2));
    assert!(single.output.workspace.entry.is_none());
    assert_eq!(single.output.workspace.root, ".");
}

#[test]
fn an_entry_outside_the_root_or_missing_is_a_located_error() {
    let outside = run_entry(&[("api.yaml", "api: { name: a }\n")], "../api.yaml");
    let missing = run(&[("other.yaml", "api: { name: a }\n")]);

    assert_eq!(outside.rules(), ["path-escape"]);
    assert_eq!(
        outside.diagnostic(0).message,
        "the entry file '../api.yaml' is outside the workspace root"
    );
    assert_eq!(
        outside
            .printed()
            .lines()
            .next()
            .map(|line| line.split(": ").next()),
        Some(Some("../api.yaml:1:1"))
    );
    assert_eq!(missing.rules(), ["file-missing"]);
    assert_eq!(missing.output.workspace.apis.len(), 0);
}

#[test]
fn an_entry_written_with_a_dot_segment_is_the_same_file() {
    let load = run_entry(&[("api.yaml", "api: { name: a }\n")], "./sub/../api.yaml");

    load.assert_clean();
    assert_eq!(load.output.read_files, ["api.yaml"]);
}

#[test]
fn a_reader_with_no_files_gives_an_error_not_a_failure() {
    let reader = MemoryReader::new(Vec::new());
    let load = run_on(&reader, "api.yaml");

    assert_eq!(load.rules(), ["file-missing"]);
}

#[test]
fn apis_load_in_the_order_the_workspace_lists_them() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { zeta: ./z.yaml, alpha: ./a.yaml }\n",
            ),
            ("z.yaml", "api: { name: zeta }\n"),
            ("a.yaml", "api: { name: alpha }\n"),
        ],
        "workspace.yaml",
    );
    let names: Vec<&str> = load
        .output
        .workspace
        .apis
        .iter()
        .map(|api| api.name.as_str())
        .collect();

    assert_eq!(names, ["zeta", "alpha"]);
    assert!(matches!(
        load.output
            .workspace
            .entry
            .as_ref()
            .and_then(|entry| entry.tree.member("workspace")),
        Some(JsonValue::Object(_))
    ));
}
