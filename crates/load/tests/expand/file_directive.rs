//! `$file`: text, JSON and YAML files read in place of the mapping that names them.

use crate::harness::expand;

const EXAMPLE_HEAD: &str = "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n";

fn example_with(value: &str) -> String {
    format!("{EXAMPLE_HEAD}          one: {{ status: 200, value: {value} }}\n")
}

#[test]
fn a_text_file_becomes_the_string_it_holds() {
    for extension in ["md", "txt", "MD"] {
        let path = format!("a.{extension}");
        let run = expand(&[
            (
                "api.yaml",
                &format!("api: {{ name: t, summary: {{ $file: ./{path} }} }}\n"),
            ),
            (path.as_str(), "line one\nline two\n"),
        ]);

        assert!(run.rules().is_empty(), "{extension}: {}", run.printed);
        assert_eq!(
            run.tree_text(),
            r#"{"api":{"name":"t","summary":"line one\nline two\n"}}"#,
            "{extension}"
        );
    }
}

#[test]
fn a_json_file_is_copied_to_each_use_with_reserved_keys_dropped_and_reported() {
    let run = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        (
            "ex.json",
            r#"{"a": {"__proto__": {"polluted": 1}, "b": 1}}"#,
        ),
    ]);

    assert_eq!(run.rules(), ["reserved-key"]);
    assert!(
        run.tree_text().contains(r#""value":{"a":{"b":1}}"#),
        "{}",
        run.tree_text()
    );
}

#[test]
fn a_json_file_read_twice_reports_its_reserved_key_once() {
    let document = format!(
        "{EXAMPLE_HEAD}          a: {{ status: 200, value: {{ $file: ./ex.json }} }}\n          b: {{ status: 200, value: {{ $file: ./ex.json }} }}\n"
    );
    let run = expand(&[
        ("api.yaml", &document),
        ("ex.json", r#"{"constructor": 1, "k": [1, 2.5, null]}"#),
    ]);

    assert_eq!(run.rules(), ["reserved-key"]);
    assert_eq!(
        run.tree_text()
            .matches(r#""value":{"k":[1,2.5,null]}"#)
            .count(),
        2
    );
}

#[test]
fn a_json_file_keeps_the_javascript_key_order_and_the_last_duplicate() {
    let run = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        ("ex.json", r#"{"b": 1, "10": 2, "a": 3, "2": 4, "b": 5}"#),
    ]);

    assert!(
        run.tree_text()
            .contains(r#""value":{"2":4,"10":2,"b":5,"a":3}"#),
        "{}",
        run.tree_text()
    );
}

#[test]
fn a_json_number_above_two_to_the_fifty_third_keeps_its_digits() {
    let run = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        ("ex.json", "[9007199254740993, 1e2]"),
    ]);

    assert!(
        run.tree_text().contains("9007199254740993"),
        "{}",
        run.tree_text()
    );
}

#[test]
fn a_json_file_that_does_not_parse_is_file_invalid() {
    let truncated = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        ("ex.json", "{\"a\": [1, 2"),
    ]);

    assert_eq!(truncated.rules(), ["file-invalid"]);
    assert!(
        truncated.diagnostics[0]
            .message
            .ends_with("is not valid JSON: Unexpected end of JSON input"),
        "{}",
        truncated.diagnostics[0].message
    );

    let empty = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        ("ex.json", ""),
    ]);

    assert_eq!(empty.rules(), ["file-invalid"]);
    assert!(
        empty.diagnostics[0]
            .message
            .ends_with("Unexpected end of JSON input")
    );

    let trailing = expand(&[
        ("api.yaml", &example_with("{ $file: ./ex.json }")),
        ("ex.json", "{} {}"),
    ]);

    assert_eq!(trailing.rules(), ["file-invalid"]);
}

#[test]
fn a_json_file_nested_deeper_than_the_limit_is_too_deep_not_a_crash() {
    for levels in [300, 5_000] {
        let deep = format!("{}{}", "[".repeat(levels), "]".repeat(levels));
        let run = expand(&[
            (
                "api.yaml",
                "api: { name: t }\nexamples:\n  one: { value: { $file: ./deep.json } }\n",
            ),
            ("deep.json", &deep),
        ]);

        assert_eq!(run.rules(), ["too-deep"], "{levels} levels");
    }
}

#[test]
fn a_json_file_at_the_depth_limit_is_read_where_it_fits() {
    // `scope.depth + json depth` must stay within 256: a file of 200 levels fits at depth 6 or so.
    let nested = format!("{}{}", "[".repeat(200), "]".repeat(200));
    let fits = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nexamples:\n  one: { value: { $file: ./deep.json } }\n",
        ),
        ("deep.json", &nested),
    ]);

    assert!(fits.rules().is_empty(), "{}", fits.printed);

    let too_deep_here = expand(&[
        (
            "api.yaml",
            "api: { name: t }\nx:\n  yy:\n    z: { $file: ./deep.json }\n",
        ),
        (
            "deep.json",
            &format!("{}1{}", "[".repeat(254), "]".repeat(254)),
        ),
    ]);

    assert_eq!(too_deep_here.rules(), ["too-deep"]);
}

#[test]
fn a_yaml_file_is_data_where_it_lands() {
    let run = expand(&[
        ("api.yaml", &example_with("{ $file: ./v.yaml }")),
        ("v.yaml", "a: ~\nb: [1, true]\n"),
    ]);

    assert_eq!(run.rules(), ["data-null"]);
    assert!(run.printed.contains("v.yaml:1:4:"), "{}", run.printed);
}

#[test]
fn a_yaml_file_that_includes_itself_is_a_file_cycle() {
    let run = expand(&[
        ("api.yaml", &example_with("{ $file: ./v.yaml }")),
        ("v.yaml", "a: { $file: ./v.yaml }\n"),
    ]);

    assert_eq!(run.rules(), ["include-cycle"]);
    assert!(
        run.diagnostics[0].message.starts_with("$file cycle (P8): "),
        "{}",
        run.diagnostics[0].message
    );
    assert!(
        run.diagnostics[0].message.ends_with("v.yaml -> v.yaml"),
        "{}",
        run.diagnostics[0].message
    );
}

#[test]
fn a_file_directive_is_refused_beside_other_keys_unless_in_data() {
    let beside = expand(&[
        (
            "api.yaml",
            "api: { name: t, summary: { $file: ./a.md, other: 1 } }\n",
        ),
        ("a.md", "x"),
    ]);

    assert_eq!(beside.rules(), ["directive-siblings"]);

    let in_data = expand(&[
        ("api.yaml", &example_with("{ $file: ./a.md, other: 1 }")),
        ("a.md", "x"),
    ]);

    assert!(in_data.rules().is_empty(), "{}", in_data.printed);
    assert!(
        in_data
            .tree_text()
            .contains(r#""value":{"$file":"./a.md","other":1}"#)
    );
}

#[test]
fn a_file_directive_that_names_no_path_is_refused() {
    for value in ["12", "[./a.md]", "~", "{ a: 1 }"] {
        let run = expand(&[(
            "api.yaml",
            &format!("api: {{ name: t, summary: {{ $file: {value} }} }}\n"),
        )]);

        assert_eq!(run.rules(), ["directive-value"], "{value}: {}", run.printed);
    }
}

#[test]
fn a_file_with_another_extension_is_refused() {
    let run = expand(&[
        (
            "api.yaml",
            "api: { name: t, summary: { $file: ./a.csv } }\n",
        ),
        ("a.csv", "x"),
    ]);

    assert_eq!(run.rules(), ["file-extension"]);
    assert_eq!(
        run.diagnostics[0].message,
        "$file reads .md, .txt, .json and .yaml files, not 'a.csv'"
    );
}

#[test]
fn a_missing_file_is_reported_by_the_store() {
    let run = expand(&[(
        "api.yaml",
        "api: { name: t, summary: { $file: ./gone.md } }\n",
    )]);

    assert_eq!(run.rules(), ["file-missing"]);
}
