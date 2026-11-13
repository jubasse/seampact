//! P6 and the data positions: which scalars the authoring schema accepts where (scalar-type.test.ts
//! and the data cases of hardening, budget and pitfalls).

use seampact_authoring::{ApiLayer, FileLayer};
use seampact_ir::PackName;

use crate::harness::{Options, RootChoice, expand, expand_with, owned};

/// A document with `$V` where the scalar goes, the values the schema refuses there (one per YAML
/// type it does not accept, null in its three spellings) and the values it accepts.
struct Case {
    name: &'static str,
    expects: &'static str,
    doc: &'static str,
    refused: &'static [&'static str],
    accepted: &'static [&'static str],
}

const NULLS: [&str; 3] = ["~", "null", ""];

fn cases() -> Vec<Case> {
    let with_nulls = |values: &[&'static str]| -> &'static [&'static str] {
        Box::leak(
            values
                .iter()
                .copied()
                .chain(NULLS)
                .collect::<Vec<_>>()
                .into_boxed_slice(),
        )
    };

    vec![
        Case {
            name: "a string (api.summary)",
            expects: "a string",
            doc: "api: { name: t, summary: $V }\n",
            refused: with_nulls(&["12", "1.5", "true"]),
            accepted: &["text", "'12'", "\"true\"", "'~'"],
        },
        Case {
            name: "an integer (a scalar's minLength)",
            expects: "an integer",
            doc: "api: { name: t }\nscalars:\n  Id: { type: string, minLength: $V }\n",
            refused: with_nulls(&["'3'", "1.5", "true"]),
            accepted: &["3", "0", "3.0"],
        },
        Case {
            name: "a number (a scalar's maximum)",
            expects: "a number",
            doc: "api: { name: t }\nscalars:\n  Id: { type: integer, maximum: $V }\n",
            refused: with_nulls(&["'3'", "true"]),
            accepted: &["3", "3.5", "-1"],
        },
        Case {
            name: "a boolean (a route's internal)",
            expects: "a boolean",
            doc: "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        internal: $V\n",
            refused: with_nulls(&["'true'", "1", "1.5"]),
            accepted: &["true", "false"],
        },
        Case {
            name: "a string or an integer (api.version)",
            expects: "an integer or a string",
            doc: "api: { name: t, version: $V }\n",
            // A quoted whole number the integer branch takes is written as the integer.
            refused: with_nulls(&["1.5", "true", "'1'", "\"0\"", "'12'"]),
            accepted: &["1", "'2027-06-30'", "'-1'", "'1.0'", "'01'"],
        },
        Case {
            name: "a mapping (a scalar written for routes)",
            expects: "a mapping",
            doc: "api: { name: t }\nsurfaces:\n  app:\n    routes: $V\n",
            refused: with_nulls(&["12", "text", "true"]),
            accepted: &["{}"],
        },
        Case {
            name: "a list (a scalar written for upstream)",
            expects: "a list",
            doc: "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        upstream: $V\n",
            refused: with_nulls(&["12", "text", "true"]),
            accepted: &["[a]"],
        },
    ]
}

#[test]
fn a_scalar_of_another_type_is_refused_where_the_schema_names_its_type() {
    for case in cases() {
        for value in case.refused {
            let document = case.doc.replace("$V", value);
            let run = expand(&[("api.yaml", &document)]);
            let context = format!("{}: refuses {value:?}", case.name);

            assert_eq!(run.rules(), ["scalar-type"], "{context}");
            assert!(
                run.diagnostics[0]
                    .message
                    .contains(&format!("the schema expects {}", case.expects)),
                "{context}: {}",
                run.diagnostics[0].message
            );
            assert!(
                run.printed.starts_with("api.yaml:")
                    && run.printed.contains(" error seampact/load/scalar-type: ")
                    && run.printed.contains(" Fix: ")
                    && run.printed.ends_with('.'),
                "{context}: {}",
                run.printed
            );
        }
    }
}

#[test]
fn a_scalar_of_the_named_type_is_accepted() {
    for case in cases() {
        for value in case.accepted {
            let document = case.doc.replace("$V", value);
            let run = expand(&[("api.yaml", &document)]);

            assert!(
                run.rules().is_empty(),
                "{}: accepts {value:?}: {}",
                case.name,
                run.printed
            );
        }
    }
}

#[test]
fn the_adr_p6_examples_are_refused_with_their_fix() {
    let examples = [
        (
            "version: '1'",
            "api: { name: t, version: '1' }\n",
            "write 1",
        ),
        ("name: 12", "api: { name: 12, version: 1 }\n", "quote it"),
        (
            "summary: ~",
            "api: { name: t, summary: ~ }\n",
            "write a string",
        ),
        (
            "summary: with no value",
            "api:\n  name: t\n  summary:\n",
            "write a string",
        ),
    ];

    for (name, document, fix) in examples {
        let run = expand(&[("api.yaml", document)]);
        let refused: Vec<_> = run
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.rule.as_str() == "seampact/load/scalar-type")
            .collect();

        assert_eq!(refused.len(), 1, "{name}");
        assert!(refused[0].fix.contains(fix), "{name}: {}", refused[0].fix);
    }
}

#[test]
fn the_diagnostic_is_located_at_the_scalar() {
    let run = expand(&[("api.yaml", "api:\n  name: t\n  summary: 12\n")]);

    assert!(run.printed.starts_with("api.yaml:3:12:"), "{}", run.printed);
}

#[test]
fn a_quoted_number_is_a_string_and_refused_where_a_number_goes() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nscalars:\n  Id: { type: string, minLength: '3' }\n",
    )]);

    assert!(
        run.diagnostics[0].message.contains("'\"3\"' is a string"),
        "{}",
        run.diagnostics[0].message
    );
}

#[test]
fn a_position_the_schemas_say_nothing_about_is_left_to_the_validate_stage() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nnotAKeyword: 12\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        madeUp: [1, true, ~]\n",
    )]);

    assert!(run.rules().is_empty(), "{}", run.printed);
}

#[test]
fn a_data_position_takes_any_type_and_null_is_written_null() {
    let document = |value: &str| {
        format!(
            "api: {{ name: t }}\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n          e: {{ status: 200, value: {value} }}\n"
        )
    };

    for value in ["12", "true", "'x'", "[1, null]", "null", "{ a: 1.5 }"] {
        let run = expand(&[("api.yaml", &document(value))]);

        assert!(run.rules().is_empty(), "{value}: {}", run.printed);
    }

    assert_eq!(
        expand(&[("api.yaml", &document("~"))]).rules(),
        ["data-null"]
    );
}

#[test]
fn a_scalar_in_a_pack_file_is_typed_by_the_pack_schema() {
    let options = Options {
        entry: "p.yaml",
        layer: FileLayer::Api(ApiLayer::Pack(PackName::new("p".to_owned()))),
        ..Options::default()
    };
    let run = expand_with(
        owned(&[(
            "p.yaml",
            "pack: { name: p, version: 1.0.0 }\nscalars:\n  Id: { type: string, minLength: x }\n",
        )]),
        &options,
    );

    assert_eq!(run.rules(), ["scalar-type"]);
    assert!(run.printed.contains("p.yaml:3:"), "{}", run.printed);
}

#[test]
fn a_scalar_reached_through_include_is_typed_at_the_including_position() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nscalars:\n  Id: { type: string, $include: ./id.yaml }\n",
        ),
        ("id.yaml", "minLength: x\n"),
    ]);

    assert_eq!(run.rules(), ["scalar-type"]);
    assert!(run.printed.contains("id.yaml:1:12:"), "{}", run.printed);
}

#[test]
fn an_extension_value_is_not_data_and_file_keeps_its_rule() {
    let run = expand(&[
        (
            "api.yaml",
            "api:\n  name: t\n  x-acme-note: ~\n  x-acme-doc: { $file: ./a.md, b: 1 }\n",
        ),
        ("a.md", "text\n"),
    ]);

    assert_eq!(run.rules(), ["directive-siblings"]);
}

#[test]
fn an_included_routes_keys_are_typed_not_taken_for_a_collection() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        $include: ./r.yaml\n        internal: ~\n        examples:\n          e: { status: 200, value: ~ }\n",
        ),
        ("r.yaml", "method: get\n"),
    ]);

    assert_eq!(run.rules(), ["scalar-type", "data-null"]);
    assert!(
        run.printed
            .contains("api.yaml:7:19: error seampact/load/scalar-type"),
        "{}",
        run.printed
    );
}

#[test]
fn a_scalar_the_pitfalls_refuse_gets_no_p6_report() {
    for value in ["1_000", "0x1F", "yes", "2027-06-30"] {
        let run = expand(&[(
            "api.yaml",
            &format!("api: {{ name: t }}\nscalars:\n  Id: {{ type: integer, maximum: {value} }}\n"),
        )]);

        assert_eq!(run.rules().len(), 1, "{value}: {}", run.printed);
        assert!(!run.rules().contains(&"scalar-type"), "{value}");
    }
}

#[test]
fn a_scalar_type_message_writes_an_active_character_escaped() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nscalars:\n  Id: { type: string, minLength: \"a\\u202Eb\" }\n",
    )]);

    assert_eq!(run.rules(), ["scalar-type"]);
    assert!(!run.printed.contains('\u{202E}'));
    assert!(run.printed.contains("\\u202E"), "{}", run.printed);
}

#[test]
fn a_list_item_of_a_data_list_is_data_and_its_directives_stay_literal() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nschemas:\n  T:\n    type: string\n    examples: [~, { $include: ./x.yaml }, { $ref: X }]\n",
        ),
        ("x.yaml", "a: 1\n"),
    ]);

    assert_eq!(run.rules(), ["data-null"]);
    assert!(run.printed.contains("api.yaml:5:16:"), "{}", run.printed);
    assert_eq!(
        run.tree_text(),
        r#"{"api":{"name":"t"},"schemas":{"T":{"type":"string","examples":[null,{"$include":"./x.yaml"},{"$ref":"X"}]}}}"#
    );
    assert!(!run.read_files.contains(&"x.yaml".to_owned()));
}

#[test]
fn the_fix_for_a_mapping_names_its_keys() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      notes:\n        kind: collection\n        ops:\n          list: { paging: { limit: 20 } }\n",
    )]);

    assert!(
        run.printed.contains("where the schema expects a mapping"),
        "{}",
        run.printed
    );
    assert!(
        run.printed
            .contains("write a mapping with the keys defaultLimit, maxLimit, overLimit, token"),
        "{}",
        run.printed
    );
}

#[test]
fn a_property_named_key_keeps_its_data_positions() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t }\nschemas:\n  T:\n    properties:\n      key: { type: string, default: ~ }\n      paging: { type: string, default: ~ }\nschemes:\n  s: { kind: signature, key: { value: ~ } }\nconventions:\n  paging: { default: ~ }\n",
    )]);

    assert_eq!(
        run.rules(),
        ["data-null", "data-null", "scalar-type", "scalar-type"]
    );
    assert!(
        run.diagnostics[..2]
            .iter()
            .all(|diagnostic| diagnostic.message
                == "null is written '~' here; in a data position it must be written null")
    );
}

#[test]
fn an_include_at_the_root_of_an_entry_file_is_read_by_the_entry_root() {
    let options = Options {
        entry: "workspace.yaml",
        layer: FileLayer::Workspace,
        root: RootChoice::Entry,
        ..Options::default()
    };
    let run = expand_with(
        owned(&[
            ("workspace.yaml", "$include: ./ws.yaml\n"),
            ("ws.yaml", "workspace:\n  apis:\n    a: ./a.yaml\n"),
        ]),
        &options,
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.fragments.len(), 1);
    assert_eq!(run.fragments[0].file, "ws.yaml");
    assert_eq!(run.fragments[0].kind, None);
}
