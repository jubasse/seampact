//! The reader and validator of `differences.yaml`.

#![cfg(test)]

mod support;

use std::fs;

use seampact_oracle::{DIFFERENCES_FILE, differences_problems, read_differences};
use serde_json::{Value, json};
use support::{repository_root, scratch_directory};

const DECISION: &str = "docs/adr/0031-rust-core.md#decision";

fn entry(overrides: &Value) -> Value {
    let mut entry: Value = serde_json::from_str(&format!(
        r#"{{
            "id": "big-integers-exact",
            "reason": "Integers above 2^53 are written exactly instead of rounded.",
            "decision": "{DECISION}",
            "applies": {{ "fixtures": ["golden/every-default/**"], "output": "ir", "pointer": "/schemas/*/default" }},
            "change": "value",
            "from": 9007199254740992,
            "to": 9007199254740993
        }}"#
    ))
    .unwrap();

    for (name, value) in overrides.as_object().unwrap() {
        entry[name] = value.clone();
    }

    entry
}

fn document(entries: &[Value]) -> Value {
    json!({ "version": 1, "differences": entries })
}

fn assert_refused(entries: &[Value]) {
    let found = problems(entries);

    assert_ne!(found.len(), 0, "{entries:?}");
}

fn problems(entries: &[Value]) -> Vec<String> {
    differences_problems(&repository_root(), &document(entries)).unwrap()
}

#[test]
fn the_committed_file_is_valid_and_lists_the_exact_big_integers() {
    let root = repository_root();
    let differences = read_differences(&root, &root.join(DIFFERENCES_FILE)).unwrap();
    let ids: Vec<&str> = differences
        .differences
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();

    for id in [
        "big-integers-exact",
        "big-integers-exact-tree-schemas",
        "big-integers-exact-derive-errors",
    ] {
        assert!(ids.contains(&id), "{ids:?}");
    }
}

#[test]
fn an_entry_with_a_value_change_a_pointer_and_a_committed_anchor_is_valid() {
    assert_eq!(problems(&[entry(&json!({}))]), Vec::<String>::new());
}

#[test]
fn a_generated_entry_names_a_path_and_format_applies_to_generated_output_only() {
    let generated =
        json!({ "fixtures": ["reference"], "output": "generated", "path": "client/index.ts" });
    let mut generated_with_pointer = generated.clone();

    generated_with_pointer["pointer"] = json!("/a");

    assert_eq!(
        problems(&[entry(&json!({ "applies": generated, "change": "format" }))]),
        Vec::<String>::new()
    );
    assert_refused(&[entry(&json!({ "change": "format" }))]);
    assert_refused(&[entry(&json!({ "applies": generated_with_pointer }))]);
    assert_refused(&[entry(
        &json!({ "applies": { "fixtures": ["x"], "output": "ir", "path": "a" } }),
    )]);
}

#[test]
fn it_refuses_a_bad_id_an_unknown_member_an_unknown_output_and_a_missing_pointer() {
    assert_refused(&[entry(&json!({ "id": "Big_Integers" }))]);
    assert_refused(&[entry(&json!({ "because": "x" }))]);
    assert_refused(&[entry(
        &json!({ "applies": { "fixtures": ["x"], "output": "yaml", "pointer": "" } }),
    )]);
    assert_refused(&[entry(
        &json!({ "applies": { "fixtures": ["x"], "output": "ir" } }),
    )]);
}

#[test]
fn it_refuses_a_duplicate_id_and_a_decision_that_is_no_committed_anchor() {
    assert_eq!(
        problems(&[entry(&json!({})), entry(&json!({}))]),
        ["big-integers-exact: the id is used twice"]
    );
    assert_eq!(
        problems(&[entry(
            &json!({ "decision": "docs/adr/0031-rust-core.md#nowhere" })
        )]),
        ["big-integers-exact: decision docs/adr/0031-rust-core.md has no anchor nowhere"]
    );
    assert_eq!(
        problems(&[entry(&json!({ "decision": "docs/missing.md#a" }))]),
        ["big-integers-exact: decision docs/missing.md is no committed doc"]
    );
}

#[test]
fn applies_takes_an_optional_api_and_half_and_refuses_a_star_inside_a_pointer_segment() {
    let applies =
        |pointer: &str| json!({ "fixtures": ["x"], "output": "halves", "pointer": pointer });
    let mut with_api_and_half = applies("/a/*/b");

    with_api_and_half["api"] = json!("tasks");
    with_api_and_half["half"] = json!("tree");

    assert_eq!(
        problems(&[entry(&json!({ "applies": with_api_and_half }))]),
        Vec::<String>::new()
    );

    for pointer in ["/a*", "/**", "/a/**/b"] {
        assert_refused(&[entry(&json!({ "applies": applies(pointer) }))]);
    }
}

#[test]
fn it_refuses_an_api_or_a_half_on_an_output_that_has_none() {
    let applies = |output: &str, member: &str| {
        let mut applies = json!({ "fixtures": ["x"], "output": output, "pointer": "/a" });

        applies[member] = json!("tasks");

        applies
    };

    assert_eq!(
        problems(&[entry(&json!({ "applies": applies("diagnostics", "api") }))]),
        ["big-integers-exact: output diagnostics has no api: remove applies.api"]
    );

    for output in ["diagnostics", "ir", "source-map"] {
        assert_eq!(
            problems(&[entry(&json!({ "applies": applies(output, "half") }))]),
            [format!(
                "big-integers-exact: output {output} has no half: remove applies.half"
            )]
        );
    }

    for output in ["ir", "source-map", "halves", "openapi"] {
        assert_eq!(
            problems(&[entry(&json!({ "applies": applies(output, "api") }))]),
            Vec::<String>::new(),
            "{output}"
        );
    }

    assert_eq!(
        problems(&[entry(&json!({
            "applies": { "fixtures": ["x"], "output": "generated", "path": "**", "api": "tasks", "half": "tree" }
        }))]),
        Vec::<String>::new()
    );
}

#[test]
fn it_refuses_a_decision_path_that_climbs_out_of_docs() {
    assert_eq!(
        problems(&[entry(&json!({ "decision": "docs/../package.json.md#a" }))]),
        ["big-integers-exact: decision docs/../package.json.md has a '..' segment"]
    );
}

#[test]
fn it_reads_an_integer_above_2_pow_53_without_rounding_it() {
    let directory = scratch_directory("differences");
    let path = directory.join("differences.yaml");

    fs::write(
        &path,
        format!(
            "version: 1
differences:
  - id: big-integers-exact
    reason: Integers above 2^53 are written exactly.
    decision: {DECISION}
    applies: {{ fixtures: [\"a/**\"], output: ir, pointer: \"/x\" }}
    change: value
    to: 9007199254740993
"
        ),
    )
    .unwrap();

    let differences = read_differences(&repository_root(), &path).unwrap();

    fs::write(&path, "version: 2\ndifferences: []\n").unwrap();

    let invalid = read_differences(&repository_root(), &path);

    fs::remove_dir_all(&directory).unwrap();

    assert_eq!(differences.version, 1);
    assert_eq!(
        differences
            .differences
            .first()
            .and_then(|entry| entry.to.as_ref()),
        Some(&serde_json::from_str::<Value>("9007199254740993").unwrap())
    );
    assert!(invalid.unwrap_err().to_string().contains("is invalid"));
}
