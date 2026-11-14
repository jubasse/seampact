//! `$include`: the mappings of other files merged where they are named, and every way it is
//! refused (pitfalls P7 and P8, hardening C-1, C-6, C-8 and C-9, fragments, property).

use seampact_authoring::{ApiLayer, FileLayer};

use crate::harness::{Options, expand, expand_with, owned};

#[test]
fn an_included_mapping_keeps_the_place_of_the_include() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  S:\n    a: 1\n    $include: ./bc.yaml\n    d: 4\n",
        ),
        ("bc.yaml", "b: 2\nc: 3\n"),
    ]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(
        run.tree_text(),
        r#"{"api":{"name":"t"},"schemas":{"S":{"a":1,"b":2,"c":3,"d":4}}}"#
    );
}

#[test]
fn a_path_written_in_an_included_file_resolves_against_that_file() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: ./parts/head.yaml\n",
        ),
        ("parts/head.yaml", "$include: ./deep/tail.yaml\n"),
        ("parts/deep/tail.yaml", "z: 1\n"),
    ]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.tree_text(), r#"{"api":{"name":"t"},"x":{"z":1}}"#);
    assert_eq!(
        run.read_files,
        ["api.yaml", "parts/head.yaml", "parts/deep/tail.yaml"]
    );
}

#[test]
fn an_include_takes_a_list_of_paths_in_order() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: [./a.yaml, ./b.yaml]\n",
        ),
        ("a.yaml", "a: 1\n"),
        ("b.yaml", "b: 2\n"),
    ]);

    assert_eq!(run.tree_text(), r#"{"api":{"name":"t"},"x":{"a":1,"b":2}}"#);
}

#[test]
fn an_include_by_pointer_merges_the_mapping_it_points_at() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: ./f.yaml#/Fragment\n",
        ),
        ("f.yaml", "Fragment:\n  a: 1\nOther: { x: 1 }\n"),
    ]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.tree_text(), r#"{"api":{"name":"t"},"x":{"a":1}}"#);
}

#[test]
fn a_pointer_that_matches_nothing_is_reported_at_the_path() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: ./f.yaml#/Nope\n",
        ),
        ("f.yaml", "Fragment: {}\n"),
    ]);

    assert_eq!(run.rules(), ["include-fragment"]);
    assert!(
        run.diagnostics[0]
            .message
            .contains("the pointer '#/Nope' of './f.yaml#/Nope' matches nothing in 'f.yaml'"),
        "{}",
        run.diagnostics[0].message
    );
}

#[test]
fn a_list_segment_of_a_pointer_is_an_array_index() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: ./f.yaml#/list/1\n",
        ),
        ("f.yaml", "list:\n  - a: 1\n  - b: 2\n"),
    ]);

    assert_eq!(run.tree_text(), r#"{"api":{"name":"t"},"x":{"b":2}}"#);
}

#[test]
fn an_include_of_something_that_is_no_mapping_is_a_shape_error() {
    let run = expand(&[
        ("api.yaml", "api: { name: t }\nx:\n  $include: ./f.yaml\n"),
        ("f.yaml", "- a\n- b\n"),
    ]);

    assert_eq!(run.rules(), ["include-shape"]);
    assert!(
        run.diagnostics[0]
            .message
            .contains("does not hold a mapping")
    );
}

#[test]
fn an_include_item_that_is_no_path_is_a_shape_error() {
    for value in ["12", "[./a.yaml, 12]", "{ a: 1 }", "~"] {
        let run = expand(&[
            (
                "api.yaml",
                &format!("api: {{ name: t }}\nx:\n  $include: {value}\n"),
            ),
            ("a.yaml", "a: 1\n"),
        ]);

        assert_eq!(run.rules(), ["include-shape"], "{value}: {}", run.printed);
        assert_eq!(
            run.diagnostics[0].message,
            "$include takes a path, or a list of paths"
        );
    }
}

#[test]
fn an_include_under_routes_is_refused() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      $include: ./r.yaml\n",
        ),
        ("r.yaml", "r: { method: get }\n"),
    ]);

    assert_eq!(run.rules(), ["include-under-routes"]);
}

#[test]
fn a_second_include_in_one_mapping_is_a_duplicate_key() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  $include: ./a.yaml\n  $include: ./b.yaml\n",
        ),
        ("a.yaml", "a: 1\n"),
        ("b.yaml", "b: 2\n"),
    ]);

    assert_eq!(run.rules(), ["duplicate-key"]);
    assert!(
        run.printed.contains("key '$include' is defined twice"),
        "{}",
        run.printed
    );
    assert!(
        run.printed.contains("first defined here"),
        "{}",
        run.printed
    );
    assert!(!run.read_files.contains(&"b.yaml".to_owned()));
}

#[test]
fn a_key_written_twice_is_a_duplicate_inline_and_through_an_include() {
    let inline = expand(&[("api.yaml", "api: { name: t }\nx:\n  a: 1\n  a: 2\n")]);

    assert_eq!(inline.rules(), ["duplicate-key"]);
    assert!(
        inline.printed.contains("api.yaml:4:3:"),
        "{}",
        inline.printed
    );

    let included = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  a: 1\n  $include: ./a.yaml\n",
        ),
        ("a.yaml", "a: 2\n"),
    ]);

    assert_eq!(included.rules(), ["duplicate-key"]);
    assert!(
        included.printed.contains("a.yaml:1:1:"),
        "{}",
        included.printed
    );
    assert!(
        included
            .printed
            .contains("api.yaml:3:3: first defined here"),
        "{}",
        included.printed
    );
}

#[test]
fn an_include_cycle_names_the_files_of_the_chain() {
    let run = expand(&[
        ("api.yaml", "api: { name: t }\nx:\n  $include: ./a.yaml\n"),
        ("a.yaml", "k:\n  $include: ./b.yaml\n"),
        ("b.yaml", "m:\n  $include: ./a.yaml\n"),
    ]);

    assert_eq!(run.rules(), ["include-cycle"]);
    assert!(
        run.diagnostics[0]
            .message
            .contains("a.yaml -> b.yaml -> a.yaml"),
        "{}",
        run.diagnostics[0].message
    );
    assert_eq!(run.diagnostics[0].related.len(), 1);
}

#[test]
fn a_cycle_through_a_directory_link_is_found_on_the_real_path() {
    let options = Options {
        links: vec![("loop".to_owned(), ".".to_owned())],
        ..Options::default()
    };
    let run = expand_with(
        owned(&[
            ("api.yaml", "api: { name: t }\nx:\n  $include: ./a.yaml\n"),
            ("a.yaml", "k:\n  $include: ./loop/a.yaml\n"),
        ]),
        &options,
    );

    assert_eq!(run.rules(), ["include-cycle"]);
    assert!(
        run.diagnostics[0].message.contains("a.yaml -> loop/a.yaml"),
        "{}",
        run.diagnostics[0].message
    );
}

#[test]
fn an_authored_proto_key_is_refused_wherever_it_is_written() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nextensions:\n  __proto__: { polluted: 1 }\nschemas:\n  constructor: { type: string }\n  T: { properties: { prototype: { type: string } } }\n",
    )]);

    assert_eq!(
        run.rules(),
        ["reserved-key", "reserved-key", "reserved-key"]
    );
    assert!(
        run.printed
            .contains("api.yaml:3:3: error seampact/load/reserved-key"),
        "{}",
        run.printed
    );
    assert_eq!(
        run.tree_text(),
        r#"{"api":{"name":"t"},"extensions":{},"schemas":{"T":{"properties":{}}}}"#
    );
}

#[test]
fn a_reserved_key_is_refused_in_a_data_position_too() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n          one: { status: 200, value: { __proto__: { polluted: 1 } } }\n",
    )]);

    assert_eq!(run.rules(), ["reserved-key"]);
}

#[test]
fn a_key_that_is_no_scalar_is_refused() {
    let run = expand(&[("api.yaml", "api: { name: t }\nx:\n  ? [a, b]\n  : 1\n")]);

    assert_eq!(run.rules(), ["key-not-scalar"]);
}

#[test]
fn an_authored_key_with_escape_sequences_prints_inert() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nx:\n  \"\\e[2J\": 1\n  \"\\e[2J\": 2\n",
    )]);

    assert_eq!(run.rules(), ["duplicate-key"]);
    assert!(
        run.printed.contains("key '\\u001B[2J' is defined twice"),
        "{}",
        run.printed
    );
    assert!(!run.printed.contains('\u{1b}'));
}

#[test]
fn a_layer_file_that_is_no_mapping_is_reported_at_its_top() {
    let run = expand(&[("api.yaml", "- a\n- b\n")]);

    assert_eq!(run.rules(), ["file-not-mapping"]);
    assert_eq!(run.build.locs.len(), 1);
}

fn kinds_of(run: &crate::harness::Run) -> Vec<(String, Option<String>, Option<&'static str>)> {
    run.fragments
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
fn each_include_site_gives_its_own_kind() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: a, version: 1 }\nrights: { $include: ./rights.yaml }\nconventions: { $include: ./conventions.yaml }\nschemas:\n  Task: { $include: ./task.yaml }\nsurfaces:\n  public:\n    routes:\n      tasks:\n        method: get\n        output: { $ref: ./shared.yaml#/Note }\n        errors: { $include: ./errors.yaml }\n",
        ),
        ("rights.yaml", "tasks.read: {}\n"),
        ("conventions.yaml", "pathVersion: none\n"),
        ("task.yaml", "type: object\n"),
        ("shared.yaml", "Note: { type: string }\n"),
        ("errors.yaml", "{}\n"),
    ]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(
        kinds_of(&run),
        [
            ("conventions.yaml".to_owned(), None, Some("conventions")),
            ("errors.yaml".to_owned(), None, Some("node-errors")),
            ("rights.yaml".to_owned(), None, Some("rights")),
            (
                "shared.yaml".to_owned(),
                Some("/Note".to_owned()),
                Some("schemas")
            ),
            ("task.yaml".to_owned(), None, Some("schema")),
        ]
    );
}

#[test]
fn a_shared_file_included_at_its_root_is_a_base_file() {
    let options = Options {
        entry: "base.yaml",
        layer: FileLayer::Api(ApiLayer::Shared),
        ..Options::default()
    };
    let run = expand_with(
        owned(&[
            ("base.yaml", "$include: ./base-part.yaml\n"),
            ("base-part.yaml", "scalars: { Id: { type: string } }\n"),
        ]),
        &options,
    );

    assert_eq!(
        kinds_of(&run),
        [("base-part.yaml".to_owned(), None, Some("base"))]
    );
}

#[test]
fn keys_come_in_javascript_order_and_pointers_escape_slash_and_tilde() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nx:\n  b: 1\n  '10': 2\n  a/b: 3\n  '2': 4\n  c~d: 5\n",
    )]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(
        run.tree_text(),
        r#"{"api":{"name":"t"},"x":{"2":4,"10":2,"b":1,"a/b":3,"c~d":5}}"#
    );
    assert!(run.build.locs.contains_key("/x/a~1b"));
    assert!(run.build.locs.contains_key("/x/c~0d"));
    assert!(run.build.locs.contains_key(""));
}

const TWO_SCHEMAS: &str = "items:\n  - { type: string }\n  - { type: integer }\n";

#[test]
fn a_list_segment_is_read_as_javascript_reads_a_number() {
    for (segment, want) in [
        ("1", "integer"),
        ("01", "integer"),
        ("1.0", "integer"),
        ("0x1", "integer"),
        ("1e0", "integer"),
        ("", "string"),
    ] {
        let run = expand(&[
            (
                "api.yaml",
                &format!("api: {{ name: t }}\nx:\n  $include: ./a.yaml#/items/{segment}\n"),
            ),
            ("a.yaml", TWO_SCHEMAS),
        ]);

        assert!(run.rules().is_empty(), "{segment:?}: {}", run.printed);
        assert_eq!(
            run.tree_text(),
            format!(r#"{{"api":{{"name":"t"}},"x":{{"type":"{want}"}}}}"#),
            "{segment:?}"
        );
    }
}

#[test]
fn an_include_in_a_file_reached_by_a_file_reference_reads_a_list_segment_as_a_number() {
    // A file `$ref` names one top-level element, so a list segment is reached through the
    // `$include` its element holds.
    for (segment, want) in [("01", "integer"), ("", "string")] {
        let run = expand_with(
            owned(&[
                (
                    "api.yaml",
                    "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/Note' }\n",
                ),
                (
                    "s.yaml",
                    &format!("Note:\n  $include: ./a.yaml#/items/{segment}\n"),
                ),
                ("a.yaml", TWO_SCHEMAS),
            ]),
            &Options {
                finish_refs: true,
                ..Options::default()
            },
        );

        assert!(run.rules().is_empty(), "{segment:?}: {}", run.printed);
        assert!(
            run.tree_text()
                .contains(&format!(r#""Note":{{"type":"{want}"}}"#)),
            "{segment:?}: {}",
            run.tree_text()
        );
    }
}
