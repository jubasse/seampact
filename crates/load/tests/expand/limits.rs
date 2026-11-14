//! What bounds an expansion: the work and text budget, the nesting depth and the file size
//! (budget.test.ts D-1 and D-3, hardening C-6 and C-8).

use std::cell::Cell;

use seampact_load::{
    LOAD_MAX_WORK, LoadOptions, LoadReader, LoadText, MemoryReader, load_workspace,
};

use crate::harness::{Options, expand, expand_on, owned};

fn fan_out(levels: usize) -> Vec<(String, String)> {
    let mut files = vec![(
        "api.yaml".to_owned(),
        "api: { name: t }\nx:\n  $include: ./f0.yaml\n".to_owned(),
    )];

    for index in 0..levels {
        let text = if index + 1 < levels {
            format!(
                "a:\n  $include: ./f{next}.yaml\nb:\n  $include: ./f{next}.yaml\n",
                next = index + 1
            )
        } else {
            "z: 1\n".to_owned()
        };

        files.push((format!("f{index}.yaml"), text));
    }

    files
}

fn list_of(count: usize, target: &str) -> String {
    format!("[{}]", vec![target; count].join(", "))
}

#[test]
fn a_two_level_include_list_fan_out_over_an_empty_file_ends_at_the_expansion_limit() {
    let count = 5_000;
    let run = expand(&[
        (
            "api.yaml",
            &format!(
                "api: {{ name: t }}\nx:\n  $include: {}\n",
                list_of(count, "./b.yaml")
            ),
        ),
        (
            "b.yaml",
            &format!("$include: {}\n", list_of(count, "./e.yaml")),
        ),
        ("e.yaml", "{}\n"),
    ]);

    assert_eq!(run.rules(), ["expansion-limit"]);
    assert!(run.diagnostics[0].message.contains("units of work"));
    assert!(run.exhausted);
}

#[test]
fn many_keys_then_many_include_targets_in_one_mapping_all_load() {
    let count = 30_000;
    let mut document = String::from("api: { name: t }\nschemas:\n");

    for index in 0..count {
        document.push_str(&format!("  S{index}: {{ type: string }}\n"));
    }

    document.push_str(&format!("  $include: {}\n", list_of(count, "./e.yaml")));

    let run = expand(&[("api.yaml", &document), ("e.yaml", "{}\n")]);

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert!(run.tree_text().contains(&format!(r#""S{}":"#, count - 1)));
}

#[test]
fn many_file_sites_of_one_large_json_string_end_at_the_text_limit() {
    let mut document = String::from(
        "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n",
    );

    for index in 0..100 {
        document.push_str(&format!(
            "          e{index}: {{ status: 200, value: {{ $file: ./big.json }} }}\n"
        ));
    }

    let big = format!("\"{}\"", "x".repeat(4 * 1024 * 1024 - 16));
    let run = expand(&[("api.yaml", &document), ("big.json", &big)]);

    assert_eq!(run.rules(), ["expansion-limit"]);
    assert!(run.diagnostics[0].message.contains("characters of text"));
}

#[test]
fn distinct_include_fragments_into_one_large_file_resolve_in_linear_time() {
    let count = 50_000;
    let targets: Vec<String> = (0..count)
        .map(|index| format!("./k.yaml#/k{index}"))
        .collect();
    let keys: String = (0..count)
        .map(|index| format!("k{index}: {{}}\n"))
        .collect();
    let run = expand(&[
        (
            "api.yaml",
            &format!(
                "api: {{ name: t }}\nx:\n  $include: [{}]\n",
                targets.join(", ")
            ),
        ),
        ("k.yaml", &keys),
    ]);

    assert!(run.rules().is_empty(), "{}", run.printed);
}

#[test]
fn many_distinct_file_ref_targets_are_expanded_in_linear_time() {
    let count = 30_000;
    let mut document = String::from("api: { name: t }\nschemas:\n  A:\n    properties:\n");
    let mut elements = String::new();

    for index in 0..count {
        document.push_str(&format!("      p{index}: {{ $ref: ./s.yaml#/S{index} }}\n"));
        elements.push_str(&format!("S{index}: {{ type: string }}\n"));
    }

    let options = Options {
        finish_refs: true,
        ..Options::default()
    };
    let run = crate::harness::expand_with(
        owned(&[("api.yaml", &document), ("s.yaml", &elements)]),
        &options,
    );

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.build.refs.len(), count);
    assert!(run.tree_text().contains(&format!(r#""S{}":"#, count - 1)));
}

#[test]
fn an_include_fan_out_stops_at_the_expansion_limit() {
    // The loader's own 18 levels also count the merge of every node, which is compose's: an
    // exponential fan-out is stopped by the expansion alone.
    let run = crate::harness::expand_with(fan_out(30), &Options::default());

    assert_eq!(run.rules(), ["expansion-limit"]);
    assert!(
        run.diagnostics[0]
            .message
            .contains(&format!("more than {LOAD_MAX_WORK} units of work")),
        "{}",
        run.diagnostics[0].message
    );
}

#[test]
fn an_include_chain_longer_than_the_depth_limit_is_a_located_error() {
    let count = 300;
    let mut files = vec![(
        "api.yaml".to_owned(),
        "api: { name: t }\nx:\n  $include: ./f0.yaml\n".to_owned(),
    )];

    for index in 0..count {
        let text = if index + 1 < count {
            format!("$include: ./f{}.yaml\n", index + 1)
        } else {
            "z: 1\n".to_owned()
        };

        files.push((format!("f{index}.yaml"), text));
    }

    let run = crate::harness::expand_with(files, &Options::default());

    assert_eq!(run.rules(), ["too-deep"]);
}

#[test]
fn a_chain_just_inside_the_depth_limit_is_expanded_without_overflowing_the_stack() {
    let count = 250;
    let mut files = vec![(
        "api.yaml".to_owned(),
        "api: { name: t }\nx:\n  $include: ./f0.yaml\n".to_owned(),
    )];

    for index in 0..count {
        let text = if index + 1 < count {
            format!("$include: ./f{}.yaml\n", index + 1)
        } else {
            "z: 1\n".to_owned()
        };

        files.push((format!("f{index}.yaml"), text));
    }

    let run = crate::harness::expand_with(files, &Options::default());

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert_eq!(run.tree_text(), r#"{"api":{"name":"t"},"x":{"z":1}}"#);
}

#[test]
fn nesting_at_the_depth_limit_is_expanded_and_one_level_more_is_refused() {
    let nested = |levels: usize| {
        let mut text = String::new();

        for level in 0..levels {
            text.push_str(&format!("{}a:\n", " ".repeat(level)));
        }

        text.push_str(&format!("{}z: 1\n", " ".repeat(levels)));

        text
    };
    let fits = expand(&[("api.yaml", &nested(250))]);

    assert!(fits.rules().is_empty(), "{}", fits.printed);

    let over = expand(&[("api.yaml", &nested(300))]);

    assert_eq!(over.rules(), ["too-deep"]);
}

#[test]
fn nesting_deeper_than_the_limit_through_includes_is_a_located_error() {
    let block = |leaf: &str| {
        let mut text = String::new();

        for level in 0..60 {
            text.push_str(&format!("{}a:\n", " ".repeat(level * 2)));
        }

        text.push_str(&format!("{}{leaf}\n", " ".repeat(120)));

        text
    };
    let mut files = vec![(
        "api.yaml".to_owned(),
        "api: { name: t }\nx:\n  $include: ./f0.yaml\n".to_owned(),
    )];

    for index in 0..50 {
        let leaf = if index + 1 < 50 {
            format!("$include: ./f{}.yaml", index + 1)
        } else {
            "z: 1".to_owned()
        };

        files.push((format!("f{index}.yaml"), block(&leaf)));
    }

    let run = crate::harness::expand_with(files, &Options::default());

    assert_eq!(run.rules(), ["too-deep"]);
    assert!(run.printed.starts_with("f4.yaml:"), "{}", run.printed);
}

#[test]
fn a_file_larger_than_the_byte_cap_is_refused_unread() {
    let big = format!("k: '{}'\n", "x".repeat(4 * 1024 * 1024));
    let run = expand(&[
        ("api.yaml", "api: { name: t }\nx:\n  $include: ./big.yaml\n"),
        ("big.yaml", &big),
    ]);

    assert_eq!(run.rules(), ["file-too-large"]);
    assert!(
        run.printed
            .contains("big.yaml:1:1: error seampact/load/file-too-large"),
        "{}",
        run.printed
    );
}

/// A reader that counts the directories it lists.
struct CountingReader {
    inner: MemoryReader,
    listed: Cell<usize>,
}

impl LoadReader for CountingReader {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        self.inner.read_text(file, max_bytes)
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        self.listed.set(self.listed.get() + 1);

        self.inner.list_dir(dir)
    }

    fn real_path(&self, file: &str) -> Option<String> {
        self.inner.real_path(file)
    }

    fn ascent(&self) -> u32 {
        self.inner.ascent()
    }
}

#[test]
fn a_directory_is_listed_once_however_many_targets_it_holds() {
    let count = 250;
    let targets: Vec<String> = (0..count).map(|index| format!("./f{index}.yaml")).collect();
    let mut files = owned(&[(
        "api.yaml",
        &format!(
            "api: {{ name: t }}\nx:\n  $include: [{}]\n",
            targets.join(", ")
        ),
    )]);

    files.extend((0..count).map(|index| (format!("f{index}.yaml"), format!("k{index}: 1\n"))));

    let reader = CountingReader {
        inner: MemoryReader::new(files),
        listed: Cell::new(0),
    };
    let run = expand_on(&reader, &Options::default());

    assert!(run.rules().is_empty(), "{}", run.printed);
    assert!(reader.listed.get() <= 2, "{} listings", reader.listed.get());
}

#[test]
fn deep_nesting_and_a_long_include_chain_together_do_not_overflow_the_stack() {
    let mut nested = String::from("api: { name: t }\nx:\n");

    for level in 0..200 {
        nested.push_str(&format!("{}a:\n", " ".repeat(level + 2)));
    }

    nested.push_str(&format!("{}$include: ./f0.yaml\n", " ".repeat(202)));

    let mut files = owned(&[("api.yaml", &nested)]);

    for index in 0..50 {
        let text = if index + 1 < 50 {
            format!("$include: ./f{}.yaml\n", index + 1)
        } else {
            "z: 1\n".to_owned()
        };

        files.push((format!("f{index}.yaml"), text));
    }

    let run = crate::harness::expand_with(files, &Options::default());

    assert!(run.rules().is_empty(), "{}", run.printed);
}

#[test]
fn the_text_limit_counts_utf16_units_not_characters() {
    // One million astral characters: 4 MiB less a little in UTF-8, two million UTF-16 units. 40
    // uses are 80 million units, over the 64 million limit; by characters they would be 40
    // million.
    let mut document = String::from(
        "api: { name: t }\nsurfaces:\n  app:\n    routes:\n      r:\n        method: get\n        examples:\n",
    );

    for index in 0..40 {
        document.push_str(&format!(
            "          e{index}: {{ status: 200, value: {{ $file: ./astral.json }} }}\n"
        ));
    }

    let astral = format!("\"{}\"", "\u{1F600}".repeat(1_000_000));
    let run = expand(&[("api.yaml", &document), ("astral.json", &astral)]);

    assert_eq!(run.rules(), ["expansion-limit"]);
    assert!(run.diagnostics[0].message.contains("characters of text"));
}

/// Loads `entry` of a memory workspace: the merge of layers is the loader's, not the expander's.
fn load_memory_workspace(files: &[(&str, &str)], entry: &str) -> seampact_load::LoadOutput {
    let reader = MemoryReader::new(owned(files));

    load_workspace(&LoadOptions {
        reader: &reader,
        entry,
    })
    .expect("no internal error")
}

fn rules_of(output: &seampact_load::LoadOutput) -> Vec<&str> {
    output
        .diagnostics
        .iter()
        .map(|diagnostic| {
            diagnostic
                .rule
                .as_str()
                .trim_start_matches("seampact/load/")
        })
        .collect()
}

#[test]
fn many_apis_over_one_shared_layer_end_at_the_expansion_limit() {
    let apis = 1_500;
    let leaves = 8_000;
    let mut workspace = String::from("workspace:\n  shared: ./shared.yaml\n  apis:\n");
    let mut files: Vec<(String, String)> = Vec::new();

    for index in 0..apis {
        workspace.push_str(&format!("    a{index}: ./a{index}.yaml\n"));
        files.push((
            format!("a{index}.yaml"),
            format!("api: {{ name: a{index} }}\n"),
        ));
    }

    let shared: String = (0..leaves)
        .map(|index| format!("  k{index}: 1\n"))
        .collect();

    files.push(("workspace.yaml".to_owned(), workspace));
    files.push(("shared.yaml".to_owned(), format!("conventions:\n{shared}")));

    let reader = MemoryReader::new(files);
    let output = load_workspace(&LoadOptions {
        reader: &reader,
        entry: "workspace.yaml",
    })
    .expect("no internal error");

    assert_eq!(rules_of(&output), ["expansion-limit"]);
    assert!(output.workspace.apis.len() < apis);
}

#[test]
fn an_api_overriding_every_leaf_of_a_large_pack_merges_in_work_linear_in_its_size() {
    // The load reports `expansion-limit` once it has spent LOAD_MAX_WORK units, a count and not a
    // clock: a merge that re-walked the pack for each leaf would spend 30,000 squared units.
    let count = 30_000;
    let conventions = |value: u32| -> String {
        (0..count)
            .map(|index| format!("  k{index}: {value}\n"))
            .collect()
    };
    let output = load_memory_workspace(
        &[
            (
                "api.yaml",
                &format!(
                    "api: {{ name: t }}\npacks: [./p.yaml]\nconventions:\n{}",
                    conventions(2)
                ),
            ),
            (
                "p.yaml",
                &format!(
                    "pack: {{ name: p, version: 1.0.0 }}\nconventions:\n{}",
                    conventions(1)
                ),
            ),
        ],
        "api.yaml",
    );

    assert_eq!(rules_of(&output), Vec::<&str>::new());

    let api = output.workspace.apis.first().expect("one api");
    let origin = api
        .leaf_origins
        .get(&format!("/conventions/k{}", count - 1))
        .expect("the last leaf has an origin");

    assert_eq!(origin.layer.to_string(), "api");
    let merged = serde_json::to_value(seampact_json::JsonValue::Object(api.merged.clone()))
        .expect("a JSON tree");

    assert_eq!(
        merged.pointer("/conventions/k0"),
        Some(&serde_json::json!(2))
    );
}
