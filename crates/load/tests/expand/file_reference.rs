//! The file form of `$ref`: a name is a use, a path to a schema file names one element of it.

use seampact_authoring::{ApiLayer, FileLayer};
use seampact_load::{Expander, FileStore, LoadBudget, MemoryReader, ROOT_BOUNDARY, Reporter};
use seampact_load::{VisibleDeclaration, positions::Positions};

use crate::harness::{Options, expand, expand_with, owned};

fn with_finish() -> Options {
    Options {
        finish_refs: true,
        ..Options::default()
    }
}

#[test]
fn a_name_is_a_use_not_a_file() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nschemas:\n  A: { properties: { b: { $ref: B } } }\n  B: { type: string }\n",
    )]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.build.uses.len(), 1);
    assert_eq!(run.build.uses[0].name, "B");
    assert_eq!(run.build.uses[0].pointer, "/schemas/A/properties/b/$ref");
    assert!(run.build.refs.is_empty());
}

#[test]
fn a_pointer_into_the_catalogues_is_refused() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nschemas:\n  A: { $ref: '#/schemas/B' }\n  B: { type: string }\n",
    )]);

    assert_eq!(run.rules(), ["ref-pointer"]);
}

#[test]
fn a_path_to_a_schema_file_names_one_element_that_joins_the_schemas() {
    let run = expand_with(
        owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  A: { properties: { note: { $ref: ./s.yaml#/Note } } }\n",
            ),
            (
                "s.yaml",
                "Note: { type: string }\nOther: { type: integer }\n",
            ),
        ]),
        &with_finish(),
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(
        run.tree_text(),
        r#"{"api":{"name":"t"},"schemas":{"A":{"properties":{"note":{"$ref":"Note"}}},"Note":{"type":"string"}}}"#
    );
    assert_eq!(
        run.build.sources.get("/schemas/Note").map(String::as_str),
        Some("s.yaml#/Note")
    );
    assert!(run.build.locs.contains_key("/schemas/Note"));
}

#[test]
fn a_file_with_one_element_needs_no_pointer() {
    let run = expand_with(
        owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  A: { $ref: ./one.yaml }\n",
            ),
            ("one.yaml", "Only: { type: string }\n"),
        ]),
        &with_finish(),
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert!(run.tree_text().contains(r#""A":{"$ref":"Only"}"#));
    assert!(run.tree_text().contains(r#""Only":{"type":"string"}"#));
}

#[test]
fn a_file_with_several_elements_needs_a_pointer() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  A: { $ref: ./two.yaml }\n",
        ),
        ("two.yaml", "Xa: {}\nYa: {}\n"),
    ]);

    assert_eq!(run.rules(), ["ref-file-shape"]);
    assert!(run.diagnostics[0].message.contains("declares 2 elements"));
}

#[test]
fn a_pointer_must_name_exactly_one_element_the_file_declares() {
    for pointer in ["#/a/b", "#/", "#nope"] {
        let run = expand(&[
            (
                "api.yaml",
                &format!("api: {{ name: t }}\nschemas:\n  A: {{ $ref: './s.yaml{pointer}' }}\n"),
            ),
            ("s.yaml", "a: {}\n"),
        ]);

        assert_eq!(run.rules(), ["ref-fragment"], "{pointer}: {}", run.printed);
    }

    let missing = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/Nope' }\n",
        ),
        ("s.yaml", "a: {}\n"),
    ]);

    assert_eq!(missing.rules(), ["ref-fragment"]);
    assert!(
        missing.diagnostics[0]
            .message
            .ends_with("declares no element 'Nope'")
    );
}

#[test]
fn a_file_that_is_no_mapping_is_refused() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  A: { $ref: ./s.yaml }\n",
        ),
        ("s.yaml", "- a\n"),
    ]);

    assert_eq!(run.rules(), ["ref-file-shape"]);
}

#[test]
fn a_reserved_name_is_refused() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/constructor' }\n",
        ),
        ("s.yaml", "constructor: {}\n"),
    ]);

    assert_eq!(run.rules(), ["reserved-key"]);
}

#[test]
fn what_an_element_references_in_its_own_file_comes_along() {
    let run = expand_with(
        owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/Outer' }\n",
            ),
            (
                "s.yaml",
                "Outer: { properties: { i: { $ref: Inner } } }\nInner: { type: string }\n",
            ),
        ]),
        &with_finish(),
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(
        run.build
            .sources
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["/schemas/Outer", "/schemas/Inner"]
    );
    assert_eq!(run.build.refs.len(), 1);
}

#[test]
fn the_same_element_reached_twice_is_one_declaration() {
    let run = expand_with(
        owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/Num' }\n  B: { $ref: './s.yaml#/Num' }\n",
            ),
            ("s.yaml", "Num: { type: string }\n"),
        ]),
        &with_finish(),
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.build.refs.len(), 1);
}

#[test]
fn an_element_named_like_a_schema_the_layer_declares_is_declared_twice() {
    let run = expand_with(
        owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  Num: { type: integer }\n  A: { $ref: './s.yaml#/Num' }\n",
            ),
            ("s.yaml", "Num: { type: string }\n"),
        ]),
        &with_finish(),
    );

    assert_eq!(run.rules(), ["declaration-twice"]);
    assert_eq!(
        run.diagnostics[0].message,
        "schema 'Num' is declared twice: by 's.yaml' and by this layer"
    );
    assert_eq!(run.diagnostics[0].related.len(), 1);
}

#[test]
fn an_element_a_lower_layer_declares_is_declared_twice_unless_it_is_the_same_element() {
    let files = || {
        MemoryReader::new(owned(&[
            (
                "api.yaml",
                "api: { name: t }\nschemas:\n  A: { $ref: './s.yaml#/Num' }\n",
            ),
            ("s.yaml", "Num: { type: string }\n"),
        ]))
    };

    for (source, expected) in [
        (Some("s.yaml#/Num"), Vec::<&str>::new()),
        (None, vec!["declaration-twice"]),
    ] {
        let reader = files();
        let mut store = FileStore::new(&reader).unwrap();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();
        let mut positions = Positions::new().unwrap();
        let parsed = store
            .parse(&mut reporter, "api.yaml", ROOT_BOUNDARY)
            .unwrap()
            .unwrap();
        let mut expander = Expander::new(&mut store, &mut reporter, &mut budget, &mut positions);
        let mut build = expander
            .expand_layer(&parsed, FileLayer::Api(ApiLayer::Api), None)
            .unwrap();

        expander
            .finish_refs(&mut build, |name| {
                (name == "Num").then(|| VisibleDeclaration {
                    site: None,
                    layer: FileLayer::Api(ApiLayer::Base),
                    source: source.map(str::to_owned),
                })
            })
            .unwrap();

        let rules: Vec<String> = reporter
            .diagnostics()
            .iter()
            .map(|diagnostic| {
                diagnostic
                    .rule
                    .as_str()
                    .trim_start_matches("seampact/load/")
                    .to_owned()
            })
            .collect();

        assert_eq!(rules, expected, "{source:?}");

        if source.is_none() {
            assert!(
                reporter.diagnostics()[0]
                    .message
                    .ends_with("by the layer 'base'")
            );
        }
    }
}
