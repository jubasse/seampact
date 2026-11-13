//! Packs: named by their manifest, found by path or in `node_modules`, refused with their
//! diagnostics moved to the layer that named them.

use seampact_diagnostics::DiagnosticLayer;
use seampact_load::{LOAD_MAX_DEPTH, MemoryReader};

use super::harness::{Load, owned, run, run_on};

fn package_json(extra: &str) -> String {
    format!(
        r#"{{"name":"@acme/p","version":"1.0.0","seampact":{{"role":"pack","pack":"pack.yaml"}}{extra}}}"#
    )
}

fn run_with_ascent(files: &[(&str, &str)], ascent: u32) -> Load {
    run_on(
        &MemoryReader::new(owned(files)).with_ascent(ascent),
        "api.yaml",
    )
}

#[test]
fn a_pack_whose_manifest_comes_from_an_include_is_named_by_it() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: a, version: 1 }\npacks: [./p1.yaml, ./p2.yaml]\n",
        ),
        ("p1.yaml", "$include: ./m.yaml\n"),
        ("p2.yaml", "pack: { name: p, version: 1.0.0 }\n"),
        (
            "m.yaml",
            "pack: { name: p, version: 1.0.0 }\nscalars:\n  Id: { type: string, minLength: x }\n",
        ),
    ]);
    let layers: Vec<(&str, DiagnosticLayer)> = load
        .output
        .diagnostics
        .iter()
        .map(|diagnostic| (diagnostic.rule.as_str(), diagnostic.origin.layer.clone()))
        .collect();

    assert_eq!(
        layers,
        [
            (
                "seampact/load/scalar-type",
                DiagnosticLayer::Pack("p".to_owned())
            ),
            (
                "seampact/load/pack-name-clash",
                DiagnosticLayer::Pack("p".to_owned())
            ),
        ]
    );
}

#[test]
fn a_scalar_in_a_pack_file_is_typed_by_the_pack_schema() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: [./p.yaml]\n"),
        (
            "p.yaml",
            "pack: { name: p, version: 1.0.0 }\nscalars:\n  Id: { type: string, minLength: x }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["scalar-type"]);
    assert_eq!(
        load.diagnostic(0).origin.layer,
        DiagnosticLayer::Pack("p".to_owned())
    );
}

#[test]
fn a_hash_in_a_pack_name_is_refused_before_it_becomes_a_layer() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: [./p.yaml]\n"),
        (
            "p.yaml",
            "pack: { name: 'a#/~load/x', version: 1.0.0 }\nflag: yes\n",
        ),
    ]);

    assert_eq!(load.rules(), ["pack-name", "yaml-boolean"]);
    assert!(load.printed().contains("p.yaml:1:15:"));
    assert!(load.diagnostic(0).message.contains("holds a '#'"));
    assert_eq!(load.api(0).layers.len(), 1);
    // The refused pack is no layer: what was reported while it was read is the api's.
    for diagnostic in &load.output.diagnostics {
        assert_eq!(diagnostic.origin.layer, DiagnosticLayer::Api);
    }
}

#[test]
fn a_pack_name_message_writes_an_active_character_escaped() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: [./p.yaml]\n"),
        ("p.yaml", "pack: { name: \"a#\\u202Eb\", version: 1.0.0 }\n"),
    ]);
    let message = &load.diagnostic(0).message;

    assert_eq!(load.rules(), ["pack-name"]);
    assert!(!message.contains('\u{202E}'));
    assert!(message.contains("\\u202E"));
}

#[test]
fn a_package_name_message_writes_an_active_character_escaped() {
    let load = run(&[("api.yaml", "api: { name: t }\npacks: [\"a\\u202Eb\"]\n")]);
    let message = &load.diagnostic(0).message;

    assert_eq!(load.rules(), ["pack-name"]);
    assert!(!message.contains('\u{202E}'));
    assert!(message.contains("\\u202E"));
}

#[test]
fn a_pack_in_a_package_is_a_layer_named_by_its_package() {
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
        ("node_modules/@acme/p/package.json", &package_json("")),
        (
            "node_modules/@acme/p/pack.yaml",
            "pack: { name: '@acme/p', version: 1.0.0 }\nrights: { r: {} }\n",
        ),
    ]);

    load.assert_clean();
    assert_eq!(
        load.layers(0),
        [
            (
                "pack:@acme/p".to_owned(),
                "node_modules/@acme/p/pack.yaml".to_owned()
            ),
            ("api".to_owned(), "api.yaml".to_owned())
        ]
    );
    assert!(
        load.output
            .read_files
            .contains(&"node_modules/@acme/p/package.json".to_owned())
    );
}

#[test]
fn a_package_above_the_workspace_root_is_found_by_the_walk_and_not_beyond_the_ascent() {
    let files = [
        ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
        ("../node_modules/@acme/p/package.json", &package_json("")),
        (
            "../node_modules/@acme/p/pack.yaml",
            "pack: { name: '@acme/p', version: 1.0.0 }\n",
        ),
    ];
    let found = run_with_ascent(&files, 1);
    let out_of_reach = run_with_ascent(&files, 0);

    found.assert_clean();
    assert_eq!(out_of_reach.rules(), ["pack-not-found"]);
    assert!(out_of_reach.diagnostic(0).fix.contains("./packs/p.yaml"));
}

#[test]
fn a_package_version_that_is_not_a_string_is_written_as_javascript_writes_it() {
    for (extra, shown) in [
        (r#","version":2"#, "2"),
        (r#","version":[1,[2,null],3]"#, "1,2,,3"),
        (r#","version":{"a":1}"#, "[object Object]"),
        (r#","version":null"#, "null"),
        (r#","version":1e21"#, "1e+21"),
    ] {
        let manifest = package_json(extra).replace(r#""version":"1.0.0","#, "");
        let load = run(&[
            ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
            ("node_modules/@acme/p/package.json", &manifest),
            (
                "node_modules/@acme/p/pack.yaml",
                "pack: { name: '@acme/p', version: 1.0.0 }\n",
            ),
        ]);

        assert_eq!(load.rules(), ["pack-version-mismatch"], "{extra}");
        assert!(
            load.diagnostic(0)
                .message
                .ends_with(&format!("says {shown}")),
            "{extra}: {}",
            load.diagnostic(0).message
        );
    }
}

#[test]
fn a_package_with_no_version_says_undefined() {
    let manifest = r#"{"name":"@acme/p","seampact":{"role":"pack","pack":"pack.yaml"}}"#;
    let load = run(&[
        ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
        ("node_modules/@acme/p/package.json", manifest),
        (
            "node_modules/@acme/p/pack.yaml",
            "pack: { name: '@acme/p', version: 1.0.0 }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["pack-version-mismatch"]);
    assert!(load.diagnostic(0).message.ends_with("says undefined"));
}

#[test]
fn a_pack_file_read_once_is_one_layer_for_every_api_that_names_it() {
    let load = run_workspace_of_two_apis();

    load.assert_clean();
    assert_eq!(load.api(0).layers.len(), 2);
    assert_eq!(load.api(1).layers.len(), 2);
    assert_eq!(load.api(0).layers[0].layer.to_string(), "pack:p");
    assert_eq!(load.api(1).layers[0].layer.to_string(), "pack:p");
}

fn run_workspace_of_two_apis() -> Load {
    super::harness::run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { one: ./one.yaml, two: ./two.yaml }\n",
            ),
            ("one.yaml", "api: { name: one }\npacks: [./p.yaml]\n"),
            ("two.yaml", "api: { name: two }\npacks: [./p.yaml]\n"),
            (
                "p.yaml",
                "pack: { name: p, version: 1.0.0 }\nrights: { r: {} }\n",
            ),
        ],
        "workspace.yaml",
    )
}

fn pack_chain(length: usize) -> Vec<(String, String)> {
    let mut files = vec![(
        "api.yaml".to_owned(),
        "api: { name: t }\npacks: [./p0.yaml]\n".to_owned(),
    )];

    for index in 0..length {
        let extends = if index + 1 < length {
            format!(", extends: [./p{}.yaml]", index + 1)
        } else {
            String::new()
        };

        files.push((
            format!("p{index}.yaml"),
            format!("pack: {{ name: p{index}, version: 1.0.0{extends} }}\n"),
        ));
    }

    files
}

#[test]
fn a_chain_of_packs_up_to_the_depth_limit_loads_and_a_longer_one_is_too_deep() {
    let within = run_on(&MemoryReader::new(pack_chain(LOAD_MAX_DEPTH)), "api.yaml");
    let beyond = run_on(
        &MemoryReader::new(pack_chain(LOAD_MAX_DEPTH + 40)),
        "api.yaml",
    );

    within.assert_clean();
    assert_eq!(within.api(0).layers.len(), LOAD_MAX_DEPTH + 1);
    assert_eq!(beyond.rules(), ["too-deep"]);
}

#[test]
fn a_pack_found_through_two_names_of_a_clash_keeps_the_first() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\npacks: [./a.yaml, ./b.yaml]\n",
        ),
        (
            "a.yaml",
            "pack: { name: same, version: 1.0.0 }\nrights: { a: {} }\n",
        ),
        (
            "b.yaml",
            "pack: { name: same, version: 1.0.0 }\nrights: { b: {} }\n",
        ),
    ]);

    assert_eq!(load.rules(), ["pack-name-clash"]);
    assert_eq!(load.diagnostic(0).related.len(), 1);
    assert_eq!(load.diagnostic(0).related[0].message, "also named here");
}
