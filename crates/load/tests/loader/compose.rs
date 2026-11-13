//! The behaviours of `compose.test.ts` that go through the loader: layers, includes, file
//! references and the tables each api keeps.

use serde_json::json;

use super::harness::{Load, json_of, run, run_entry};

fn related_messages(load: &Load) -> Vec<&str> {
    load.diagnostic(0)
        .related
        .iter()
        .map(|related| related.message.as_str())
        .collect()
}

#[test]
fn an_extends_conflict_names_both_locations() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: tasks }\nextends: ./base.yaml\nerrors:\n  api.forbidden: { status: 401 }\n",
        ),
        ("base.yaml", "errors:\n  api.forbidden: { status: 403 }\n"),
    ]);
    let diagnostic = load.diagnostic(0);

    assert_eq!(load.output.diagnostics.len(), 1);
    assert_eq!(diagnostic.rule.as_str(), "seampact/load/declaration-twice");
    assert_eq!(diagnostic.fix, "remove the copy");
    assert_eq!(diagnostic.related.len(), 1);

    let at = load.where_is(&diagnostic.origin);
    let first = load.where_is(&diagnostic.related[0].origin);

    assert_eq!((at.file.as_str(), at.line, at.column), ("api.yaml", 4, 3));
    assert_eq!(
        (first.file.as_str(), first.line, first.column),
        ("base.yaml", 2, 3)
    );
}

#[test]
fn an_extends_conflict_is_reported_when_the_two_are_identical() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: tasks }\nextends: ./base.yaml\nerrors:\n  api.forbidden: { status: 403 }\n",
        ),
        ("base.yaml", "errors:\n  api.forbidden: { status: 403 }\n"),
    ]);
    let printed = load.printed();

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert!(printed.contains("Fix: remove the copy."));
    assert!(printed.contains("  base.yaml:2:3: first declared here."));
}

#[test]
fn a_base_extends_nothing_and_an_api_cannot_extend_itself() {
    let load = run(&[
        ("api.yaml", "api: { name: tasks }\nextends: ./base.yaml\n"),
        ("base.yaml", "extends: ./other.yaml\n"),
        ("other.yaml", "errors: {}\n"),
    ]);
    let itself = run(&[("api.yaml", "api: { name: tasks }\nextends: ./api.yaml\n")]);

    assert_eq!(load.rules(), ["base-extends"]);
    assert_eq!(itself.rules(), ["extends-cycle"]);
}

#[test]
fn a_layer_sees_only_itself_and_what_it_builds_on() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { tasks: ./api.yaml }\n  shared: ./shared.yaml\n",
            ),
            (
                "shared.yaml",
                "packs: [./packs/s.yaml]\nschemas:\n  Shared: { type: string }\n",
            ),
            (
                "packs/s.yaml",
                "pack: { name: s, version: 1.0.0 }\nschemas:\n  FromPack: { type: string }\n",
            ),
            (
                "api.yaml",
                "api: { name: tasks }\nextends: ./base.yaml\nschemas:\n  OnlyApi: { type: string }\n",
            ),
            (
                "base.yaml",
                "schemas:\n  Uses:\n    properties:\n      a: { $ref: Shared }\n      b: { $ref: FromPack }\n      c: { $ref: OnlyApi }\n",
            ),
        ],
        "workspace.yaml",
    );
    let diagnostic = load.diagnostic(0);
    let at = load.where_is(&diagnostic.origin);
    let visibility: Vec<(String, Vec<String>)> = load
        .api(0)
        .visibility
        .iter()
        .map(|(layer, sees)| {
            (
                layer.to_string(),
                sees.iter().map(ToString::to_string).collect(),
            )
        })
        .collect();

    assert_eq!(load.rules(), ["name-not-visible"]);
    assert!(diagnostic.message.contains("'OnlyApi'"));
    assert_eq!(
        diagnostic.fix,
        "move the declaration into the shared file or the base"
    );
    assert_eq!((at.file.as_str(), at.line), ("base.yaml", 6));
    assert_eq!(diagnostic.related[0].message, "declared here");
    assert_eq!(
        visibility,
        [
            ("pack:s".to_owned(), vec!["pack:s".to_owned()]),
            (
                "shared".to_owned(),
                vec!["pack:s".to_owned(), "shared".to_owned()]
            ),
            (
                "base".to_owned(),
                vec!["base".to_owned(), "pack:s".to_owned(), "shared".to_owned()]
            ),
            (
                "api".to_owned(),
                vec![
                    "api".to_owned(),
                    "base".to_owned(),
                    "pack:s".to_owned(),
                    "shared".to_owned()
                ]
            ),
        ]
    );
}

#[test]
fn layers_are_applied_packs_first_then_shared_base_api_and_a_pack_reached_twice_once() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { tasks: ./api.yaml }\n  shared: ./shared.yaml\n",
            ),
            ("shared.yaml", "packs: [./packs/b.yaml]\n"),
            ("packs/a.yaml", "pack: { name: a, version: 1.0.0 }\n"),
            (
                "packs/b.yaml",
                "pack: { name: b, version: 1.0.0, extends: [./a.yaml] }\n",
            ),
            (
                "api.yaml",
                "api: { name: tasks }\nextends: ./base.yaml\npacks: [./packs/a.yaml, ./packs/c.yaml]\n",
            ),
            (
                "packs/c.yaml",
                "pack: { name: c, version: 1.0.0, extends: [./a.yaml] }\n",
            ),
            ("base.yaml", "packs: [./packs/a.yaml]\n"),
        ],
        "workspace.yaml",
    );
    let layers: Vec<String> = load.layers(0).into_iter().map(|(layer, _)| layer).collect();

    load.assert_clean();
    assert_eq!(
        layers,
        ["pack:a", "pack:b", "pack:c", "shared", "base", "api"]
    );
}

#[test]
fn settings_override_by_leaf() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: tasks }\nextends: ./base.yaml\npacks: [./pack.yaml]\nconventions:\n  paging: { maxLimit: 50 }\n  errors:\n    every: [b, a]\n    derived: { forbidden: api.denied }\n  cache: { families: { minute: 120s } }\n",
        ),
        (
            "pack.yaml",
            "pack: { name: p, version: 1.0.0 }\nconventions:\n  paging: { default: offset, maxLimit: 20 }\n  errors: { every: [a], derived: { forbidden: api.forbidden, missing: api.missing } }\n  cache: { families: { minute: 60s, hour: 1h } }\n",
        ),
        (
            "base.yaml",
            "conventions:\n  paging: { default: cursor }\n  header: { name: X }\n",
        ),
    ]);

    load.assert_clean();
    assert_eq!(
        load.merged(0)["conventions"],
        json!({
            "paging": { "default": "cursor", "maxLimit": 50 },
            "errors": {
                "every": ["a", "b"],
                "derived": { "forbidden": "api.denied", "missing": "api.missing" }
            },
            "cache": { "families": { "minute": "120s", "hour": "1h" } },
            "header": { "name": "X" }
        })
    );

    let origin = load
        .api(0)
        .leaf_origins
        .get("/conventions/paging/default")
        .expect("an origin");

    assert_eq!(
        (origin.layer.to_string(), origin.pointer.as_str()),
        ("base".to_owned(), "/conventions/paging/default")
    );

    for (pointer, layer) in [
        ("/conventions/paging/maxLimit", "api"),
        ("/conventions/errors/derived/missing", "pack:p"),
        ("/conventions/errors/derived/forbidden", "api"),
        ("/conventions/cache/families/hour", "pack:p"),
        ("/conventions/cache/families/minute", "api"),
        ("/conventions/header/name", "base"),
    ] {
        assert_eq!(load.layer_of_origin(0, pointer), layer, "{pointer}");
    }
}

#[test]
fn an_include_keeps_its_position() {
    let inline = run(&[(
        "api.yaml",
        "api: { name: t }\nschemas:\n  Task:\n    first: 1\n    second: 2\n    third: 3\n",
    )]);
    let included = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  Task:\n    first: 1\n    $include: ./mid.yaml\n    third: 3\n",
        ),
        ("mid.yaml", "second: 2\n"),
    ]);
    let keys: Vec<String> = included.merged(0)["schemas"]["Task"]
        .as_object()
        .expect("a mapping")
        .keys()
        .cloned()
        .collect();

    assert_eq!(included.merged_text(0), inline.merged_text(0));
    assert_eq!(keys, ["first", "second", "third"]);
    assert_eq!(
        serde_json::to_string(&included.api(0).leaf_origins).expect("origins"),
        serde_json::to_string(&inline.api(0).leaf_origins).expect("origins")
    );

    let moved = included.api_location(0, "api#/schemas/Task/second");

    assert_eq!((moved.file.as_str(), moved.line), ("mid.yaml", 1));
    assert_eq!(
        inline.api_location(0, "api#/schemas/Task/second").file,
        "api.yaml"
    );
}

#[test]
fn an_include_merges_several_files_in_list_order_and_takes_a_pointer() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  $include: [./a.yaml, ./b.yaml#/Inner]\n  Own: { type: string }\n",
        ),
        ("a.yaml", "A: { type: string }\n"),
        ("b.yaml", "Inner:\n  B: { type: string }\nOther: {}\n"),
    ]);
    let names: Vec<String> = load.merged(0)["schemas"]
        .as_object()
        .expect("a mapping")
        .keys()
        .cloned()
        .collect();

    load.assert_clean();
    assert_eq!(names, ["A", "B", "Own"]);
}

#[test]
fn an_include_is_refused_under_routes_and_nowhere_else() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      $include: ./r.yaml\n",
        ),
        ("r.yaml", "list: {}\n"),
    ]);

    assert_eq!(load.rules(), ["include-under-routes"]);
}

#[test]
fn in_a_data_position_only_a_mapping_holding_file_alone_is_processed() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n          one: { status: 200, value: { $include: ./nope.yaml, $ref: X } }\n          two: { status: 200, value: { $file: ./ex.json } }\n          three: { status: 200, value: { $file: ./ex.yaml } }\n",
        ),
        ("ex.json", "{\"a\": [1, 2]}"),
        ("ex.yaml", "b: 1\n"),
    ]);

    load.assert_clean();
    assert_eq!(
        load.merged(0)["surfaces"]["app"]["routes"]["r"]["examples"],
        json!({
            "one": { "status": 200, "value": { "$include": "./nope.yaml", "$ref": "X" } },
            "two": { "status": 200, "value": { "a": [1, 2] } },
            "three": { "status": 200, "value": { "b": 1 } }
        })
    );
}

#[test]
fn file_directives_read_text_report_a_missing_file_and_the_yaml_pitfalls() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nd: { $file: ./d.md }\nm: { $file: ./gone.md }\nyy: { $file: ./e.yaml }\n",
        ),
        ("d.md", "\u{FEFF}line one\r\nline two\r\n"),
        ("e.yaml", "flag: yes\n"),
    ]);
    let printed = load.printed();

    assert_eq!(load.rules(), ["file-missing", "yaml-boolean"]);
    assert_eq!(load.merged(0)["d"], "line one\nline two\n");
    assert!(printed.contains("api.yaml:3:13: error seampact/load/file-missing"));
    assert!(printed.contains("e.yaml:1:7: error seampact/load/yaml-boolean"));
}

#[test]
fn a_file_ref_used_twice_yields_one_element_and_keeps_its_identity() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n    two: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        (
            "schemas/task.yaml",
            "Task:\n  type: object\n  properties: { owner: { $ref: Owner } }\nOwner: { type: string }\nUnused: { type: string }\n",
        ),
    ]);
    let merged = load.merged(0);
    let names = load.member_names(0, "/schemas");

    load.assert_clean();
    assert_eq!(names, ["Task", "Owner"]);
    assert_eq!(
        merged["surfaces"]["app"]["one"]["output"],
        json!({ "$ref": "Task" })
    );
    assert_eq!(
        merged["surfaces"]["app"]["two"]["output"],
        json!({ "$ref": "Task" })
    );

    let task = load.api_location(0, "api#/schemas/Task");

    assert_eq!((task.file.as_str(), task.line), ("schemas/task.yaml", 1));
}

#[test]
fn a_file_included_into_a_catalogue_and_reached_by_ref_is_declared_once() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  $include: ./schemas/task.yaml\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        ("schemas/task.yaml", "Task: { type: object }\n"),
    ]);
    let names = load.member_names(0, "/schemas");

    load.assert_clean();
    assert_eq!(names, ["Task"]);
}

#[test]
fn a_name_found_in_the_referenced_file_and_in_the_layer_is_an_error_naming_both() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  Owner: { type: string }\nsurfaces:\n  app:\n    one: { output: { $ref: ./task.yaml#/Task } }\n",
        ),
        (
            "task.yaml",
            "Task:\n  properties: { owner: { $ref: Owner } }\nOwner: { type: integer }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert!(load.printed().contains("also declared here"));
}

#[test]
fn a_pointer_into_the_merged_catalogues_is_refused() {
    let load = run(&[(
        "api.yaml",
        "api: { name: t }\nx: { $ref: '#/schemas/Task' }\n",
    )]);

    assert_eq!(load.rules(), ["ref-pointer"]);
}

#[test]
fn a_workspace_api_name_must_equal_its_api_name() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { tasks: ./api.yaml }\n",
            ),
            ("api.yaml", "api: { name: other }\n"),
        ],
        "workspace.yaml",
    );

    assert_eq!(load.rules(), ["api-name-mismatch"]);
    assert!(
        load.diagnostic(0)
            .message
            .ends_with("and api.name is 'other'")
    );
}

#[test]
fn an_include_cycle_names_every_file() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\nx:\n  $include: ./a.yaml\n"),
        ("a.yaml", "ka:\n  $include: ./b.yaml\n"),
        ("b.yaml", "kb:\n  $include: ./c.yaml\n"),
        ("c.yaml", "kc:\n  $include: ./a.yaml\n"),
    ]);

    assert_eq!(load.rules(), ["include-cycle"]);
    assert!(
        load.diagnostic(0)
            .message
            .contains("a.yaml -> b.yaml -> c.yaml -> a.yaml")
    );
    assert_eq!(
        related_messages(&load),
        ["'b.yaml' is included here", "'c.yaml' is included here"]
    );
}

#[test]
fn a_cycle_of_pack_extends_names_every_file() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: [./a.yaml]\n"),
        (
            "a.yaml",
            "pack: { name: a, version: 1.0.0, extends: [./b.yaml] }\n",
        ),
        (
            "b.yaml",
            "pack: { name: b, version: 1.0.0, extends: [./a.yaml] }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["pack-cycle"]);
    assert!(
        load.diagnostic(0)
            .message
            .contains("a.yaml -> b.yaml -> a.yaml")
    );
}

#[test]
fn derive_entries_are_declarations_and_merge_in_layer_order() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\npacks: [./a.yaml, ./b.yaml]\n",
        ),
        (
            "a.yaml",
            "pack: { name: a, version: 1.0.0 }\nderive:\n  - { entry: crud, select: {} }\n  - { entry: other }\n",
        ),
        (
            "b.yaml",
            "pack: { name: b, version: 1.0.0 }\nderive:\n  - { entry: crud }\n  - { entry: more }\n",
        ),
    ]);
    let entries: Vec<String> = load.merged(0)["derive"]
        .as_array()
        .expect("a list")
        .iter()
        .map(|entry| entry["entry"].as_str().expect("a name").to_owned())
        .collect();
    let origin = load
        .api(0)
        .leaf_origins
        .get("/derive/2/entry")
        .expect("an origin");

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert_eq!(entries, ["crud", "other", "more"]);
    assert_eq!(
        (origin.layer.to_string(), origin.pointer.as_str()),
        ("pack:b".to_owned(), "/derive/1/entry")
    );
}

#[test]
fn the_load_is_deterministic_across_line_endings() {
    let lf = [
        (
            "api.yaml",
            "api: { name: t }\nextends: ./base.yaml\nschemas:\n  T:\n    $include: ./t.yaml\ndocs: { $file: ./d.md }\n",
        ),
        ("base.yaml", "errors:\n  a.b: { status: 400 }\n"),
        ("t.yaml", "type: object\n"),
        ("d.md", "x\ny\n"),
    ];
    let crlf: Vec<(String, String)> = lf
        .iter()
        .map(|(path, text)| {
            (
                (*path).to_owned(),
                format!("\u{FEFF}{}", text.replace('\n', "\r\n")),
            )
        })
        .collect();
    let crlf_refs: Vec<(&str, &str)> = crlf
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    let plain = run(&lf);
    let windows = run(&crlf_refs);

    assert_eq!(windows.merged_text(0), plain.merged_text(0));
    assert_eq!(
        windows.output.workspace.locations,
        plain.output.workspace.locations
    );
    assert_eq!(windows.output.diagnostics, plain.output.diagnostics);
    assert_eq!(windows.api(0).locations, plain.api(0).locations);
    assert_eq!(windows.api(0).leaf_origins, plain.api(0).leaf_origins);
}

#[test]
fn the_apis_of_one_workspace_keep_their_own_locations() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n",
            ),
            ("one.yaml", "api: { name: one }\nextends: ./b1.yaml\n"),
            ("two.yaml", "api: { name: two }\nextends: ./b2.yaml\n"),
            ("b1.yaml", "rights: { r: {} }\n"),
            ("b2.yaml", "rights: { r: {} }\n"),
        ],
        "workspace.yaml",
    );

    assert_eq!(load.api_location(0, "base#/rights/r").file, "b1.yaml");
    assert_eq!(load.api_location(1, "base#/rights/r").file, "b2.yaml");
}

#[test]
fn a_leaf_origin_resolves_to_a_position_through_its_apis_table() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n",
            ),
            ("one.yaml", "api: { name: one }\nextends: ./b1.yaml\n"),
            ("two.yaml", "api: { name: two }\nextends: ./b2.yaml\n"),
            ("b1.yaml", "conventions:\n  paging: { maxLimit: 10 }\n"),
            ("b2.yaml", "\nconventions:\n  paging:\n    maxLimit: 20\n"),
        ],
        "workspace.yaml",
    );

    load.assert_clean();

    for (index, file, line, column) in [(0, "b1.yaml", 2, 13), (1, "b2.yaml", 4, 5)] {
        let origin = load
            .api(index)
            .leaf_origins
            .get("/conventions/paging/maxLimit")
            .expect("an origin");
        let key = format!("{}#{}", origin.layer, origin.pointer);
        let at = load.api_location(index, &key);

        assert_eq!(origin.layer.to_string(), "base");
        assert_eq!((at.file.as_str(), at.line, at.column), (file, line, column));
        assert_eq!(at.end_line, line);
    }
}

#[test]
fn a_file_ref_without_a_pointer_needs_a_file_with_exactly_one_element() {
    let one = run(&[
        (
            "api.yaml",
            "api: { name: t }\nxx: { $ref: ./one.yaml }\nyy: { $ref: ./one.yaml }\n",
        ),
        ("one.yaml", "Task: { type: object }\n"),
    ]);
    let many = run(&[
        ("api.yaml", "api: { name: t }\nx: { $ref: ./two.yaml }\n"),
        ("two.yaml", "A: {}\nB: {}\n"),
    ]);
    let merged = one.merged(0);

    one.assert_clean();
    assert_eq!(merged["xx"], json!({ "$ref": "Task" }));
    assert_eq!(merged["yy"], json!({ "$ref": "Task" }));
    assert_eq!(merged["schemas"], json!({ "Task": { "type": "object" } }));
    assert_eq!(many.rules(), ["ref-file-shape"]);
}

#[test]
fn an_override_in_one_api_never_leaks_into_another_api_sharing_the_layer() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n  shared: ./shared.yaml\n",
            ),
            (
                "shared.yaml",
                "packs: [./p.yaml]\nconventions:\n  paging: { default: offset, maxLimit: 20 }\n",
            ),
            (
                "p.yaml",
                "pack: { name: p, version: 1.0.0 }\nconventions:\n  cache: { families: { minute: 60s } }\n",
            ),
            (
                "one.yaml",
                "api: { name: one }\nconventions:\n  paging: { maxLimit: 50 }\n  cache: { families: { minute: 1s } }\n",
            ),
            ("two.yaml", "api: { name: two }\n"),
        ],
        "workspace.yaml",
    );
    let shared_tree = json_of(
        &load
            .api(1)
            .layers
            .iter()
            .find(|layer| layer.layer.to_string() == "shared")
            .expect("a shared layer")
            .tree,
    );

    load.assert_clean();
    assert_eq!(
        load.merged(0)["conventions"],
        json!({
            "cache": { "families": { "minute": "1s" } },
            "paging": { "default": "offset", "maxLimit": 50 }
        })
    );
    assert_eq!(
        load.merged(1)["conventions"],
        json!({
            "cache": { "families": { "minute": "60s" } },
            "paging": { "default": "offset", "maxLimit": 20 }
        })
    );
    assert_eq!(
        load.layer_of_origin(1, "/conventions/paging/maxLimit"),
        "shared"
    );
    assert_eq!(
        load.layer_of_origin(1, "/conventions/cache/families/minute"),
        "pack:p"
    );
    assert_eq!(
        shared_tree["conventions"],
        json!({ "paging": { "default": "offset", "maxLimit": 20 } })
    );
}

#[test]
fn a_file_ref_to_one_element_from_two_layers_declares_it_once() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nextends: ./base.yaml\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        (
            "base.yaml",
            "schemas:\n  Uses:\n    properties: { a: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        ("schemas/task.yaml", "Task: { type: object }\n"),
    ]);
    let names = load.member_names(0, "/schemas");

    load.assert_clean();
    assert_eq!(names, ["Uses", "Task"]);
    assert_eq!(load.layer_of_origin(0, "/schemas/Task/type"), "base");
}

#[test]
fn a_file_ref_into_a_schema_file_another_layer_includes_points_at_the_included_element() {
    let seen = run(&[
        (
            "api.yaml",
            "api: { name: t }\nextends: ./base.yaml\nsurfaces:\n  app:\n    one: { output: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        ("base.yaml", "schemas:\n  $include: ./schemas/task.yaml\n"),
        ("schemas/task.yaml", "Task: { type: object }\n"),
    ]);
    // The including layer is not visible to the referring one: still one element.
    let unseen = run(&[
        (
            "api.yaml",
            "api: { name: t }\nextends: ./base.yaml\nschemas:\n  $include: ./schemas/task.yaml\n",
        ),
        (
            "base.yaml",
            "schemas:\n  Uses:\n    properties: { a: { $ref: ./schemas/task.yaml#/Task } }\n",
        ),
        ("schemas/task.yaml", "Task: { type: object }\n"),
    ]);
    let names = unseen.member_names(0, "/schemas");

    seen.assert_clean();
    unseen.assert_clean();
    assert_eq!(names, ["Uses", "Task"]);
}

#[test]
fn two_packs_referring_to_one_file_element_share_it() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\npacks: [./a.yaml, ./b.yaml]\n",
        ),
        (
            "a.yaml",
            "pack: { name: a, version: 1.0.0 }\nerrors:\n  a.x: { status: 400, example: 1 }\nschemas:\n  A: { properties: { m: { $ref: ./money.yaml } } }\n",
        ),
        (
            "b.yaml",
            "pack: { name: b, version: 1.0.0 }\nschemas:\n  B: { properties: { m: { $ref: ./money.yaml } } }\n",
        ),
        ("money.yaml", "Money: { type: string }\n"),
    ]);
    let names = load.member_names(0, "/schemas");

    load.assert_clean();
    assert_eq!(names, ["A", "Money", "B"]);
}

#[test]
fn an_included_element_and_a_different_element_of_the_same_name_are_two_declarations() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  $include: ./b.yaml#/Inner\nsurfaces:\n  app:\n    one: { output: { $ref: ./b.yaml#/B } }\n",
        ),
        (
            "b.yaml",
            "Inner:\n  B: { type: string }\nB: { type: integer }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["declaration-twice"]);
}

#[test]
fn two_include_keys_in_one_mapping_are_a_duplicate_key() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  $include: ./a.yaml\n  $include: ./b.yaml\n",
        ),
        ("a.yaml", "A: { type: string }\n"),
        ("b.yaml", "B: { type: string }\n"),
    ]);
    let printed = load.printed();

    assert_eq!(load.rules(), ["duplicate-key"]);
    assert!(printed.contains("api.yaml:4:3: error seampact/load/duplicate-key: key '$include'"));
    assert!(printed.contains("  api.yaml:3:3: first defined here."));
}

#[test]
fn a_paging_default_and_a_scheme_key_value_are_settings_not_data() {
    let load = run(&[(
        "api.yaml",
        "api: { name: t }\nconventions:\n  paging: { default: ~ }\nschemes:\n  s: { kind: signature, key: { value: ~ } }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n          e: { status: 200, value: ~ }\n",
    )]);

    // The settings are strings, so a null there is a type error; only the example is data.
    assert_eq!(load.rules(), ["scalar-type", "scalar-type", "data-null"]);
    assert!(load.printed().contains("api.yaml:12:36:"));
}

#[test]
fn derive_entries_named_alike_in_one_pack_say_so() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: [./a.yaml]\n"),
        (
            "a.yaml",
            "pack: { name: a, version: 1.0.0 }\nderive:\n  - { entry: crud }\n  - { entry: crud }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert!(
        load.diagnostic(0)
            .message
            .contains("declared twice in the pack 'a'")
    );
    assert!(
        load.printed()
            .contains("  a.yaml:3:5: first declared here.")
    );
}

#[test]
fn derive_entries_named_alike_in_one_api_file_name_the_file_not_a_pack() {
    let load = run(&[(
        "api.yaml",
        "api: { name: t }\nderive:\n  - { entry: crud }\n  - { entry: crud }\n",
    )]);

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert!(
        load.diagnostic(0)
            .message
            .contains("is declared twice in 'api.yaml'")
    );
    assert!(!load.diagnostic(0).message.contains("pack"));
}

#[test]
fn a_later_layer_filling_an_empty_mapping_leaves_no_stale_origin_on_the_mapping() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\npacks: [./p.yaml]\nconventions:\n  header: { name: X }\n  empty: {}\n",
        ),
        (
            "p.yaml",
            "pack: { name: p, version: 1.0.0 }\nconventions:\n  header: {}\n  empty: {}\n",
        ),
    ]);
    let origins = &load.api(0).leaf_origins;

    assert!(origins.get("/conventions/header").is_none());
    assert_eq!(load.layer_of_origin(0, "/conventions/header/name"), "api");
    assert_eq!(load.layer_of_origin(0, "/conventions/empty"), "api");
}

#[test]
fn a_name_not_visible_points_at_its_declaration_even_when_the_name_needs_escaping() {
    let load = run_entry(
        &[
            ("workspace.yaml", "workspace:\n  apis: { t: ./api.yaml }\n"),
            (
                "api.yaml",
                "api: { name: t }\nextends: ./base.yaml\nschemas:\n  A~B: { type: string }\n",
            ),
            (
                "base.yaml",
                "schemas:\n  Uses: { properties: { a: { $ref: A~B } } }\n",
            ),
        ],
        "workspace.yaml",
    );

    assert_eq!(load.rules(), ["name-not-visible"]);
    assert!(load.printed().contains("  api.yaml:4:3: declared here."));
}
