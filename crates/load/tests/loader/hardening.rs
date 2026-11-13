//! The loader cases of `hardening.test.ts`: reserved names, package names that leave
//! `node_modules`, links out of a package and the work limit through the whole load.

use seampact_load::{LOAD_MAX_WORK, MemoryReader};

use super::harness::{SpyReader, owned, run, run_entry, run_on};

const VICTIM_PACKAGE: &str =
    r#"{"name":"x","version":"1.0.0","seampact":{"role":"pack","pack":"pack.yaml"}}"#;

fn victim_files() -> Vec<(String, String)> {
    owned(&[
        ("../../victim/proj/package.json", VICTIM_PACKAGE),
        (
            "../../victim/proj/pack.yaml",
            "pack: { name: x, version: 1.0.0 }\nrights: { stolen: {} }\n",
        ),
    ])
}

fn spy_of(files: Vec<(String, String)>) -> SpyReader {
    SpyReader::new(MemoryReader::new(files))
}

#[test]
fn reserved_api_names_are_refused() {
    let workspace = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { __proto__: ./a.yaml, ok: ./b.yaml }\n",
            ),
            ("a.yaml", "api: { name: __proto__ }\n"),
            ("b.yaml", "api: { name: ok }\n"),
        ],
        "workspace.yaml",
    );
    let single = run(&[("api.yaml", "api: { name: constructor }\n")]);
    let names: Vec<&str> = workspace
        .output
        .workspace
        .apis
        .iter()
        .map(|api| api.name.as_str())
        .collect();

    assert_eq!(workspace.rules(), ["reserved-key"]);
    assert_eq!(names, ["ok"]);
    assert_eq!(single.rules(), ["reserved-key"]);
    assert_eq!(single.output.workspace.apis.len(), 0);
}

#[test]
fn a_merged_tree_holds_only_what_was_written() {
    let load = run(&[(
        "api.yaml",
        "api: { name: t }\nconventions: { paging: { maxLimit: 1 } }\n",
    )]);
    let api = load.api(0);

    assert!(api.merged.get("constructor").is_none());
    assert!(api.merged.get("__proto__").is_none());
    assert!(api.merged.get("conventions").is_some());
    assert_eq!(
        api.visibility
            .keys()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        ["api"]
    );
}

#[test]
fn a_package_name_that_leaves_node_modules_is_refused_before_any_read() {
    let long = "x".repeat(215);
    let names = [
        "x/../../../../victim/proj",
        "@x/../../../../victim/proj",
        "..",
        "x\\..\\..",
        "Upper",
        ".hidden",
        "@scope/",
        "a/b/c",
        long.as_str(),
        "progra~1",
        "@*/x",
        "@acme/*",
        "~x",
    ];

    for name in names {
        let api = format!("api: {{ name: t }}\npacks: ['{name}']\n");
        let mut files = victim_files();

        files.push(("api.yaml".to_owned(), api));

        let reader = spy_of(files);
        let load = run_on(&reader, "api.yaml");

        assert_eq!(load.rules(), ["pack-name"], "{name}");
        assert_eq!(reader.reads(), ["api.yaml"], "{name}");
        assert!(!load.merged_text(0).contains("stolen"), "{name}");
    }
}

#[test]
fn a_pack_extends_naming_a_bad_package_is_refused_too() {
    let mut files = victim_files();

    files.push((
        "api.yaml".to_owned(),
        "api: { name: t }\npacks: [./p.yaml]\n".to_owned(),
    ));
    files.push((
        "p.yaml".to_owned(),
        "pack: { name: p, version: 1.0.0, extends: ['x/../../../../victim/proj'] }\n".to_owned(),
    ));

    let load = run_on(&MemoryReader::new(files), "api.yaml");

    assert_eq!(load.rules(), ["pack-name"]);
}

#[test]
fn seampact_pack_is_a_path_inside_the_package() {
    for (entry, rule) in [
        ("../../../api.yaml", "path-escape"),
        ("/etc/passwd", "path-absolute"),
        ("lib\\\\pack.yaml", "path-backslash"),
    ] {
        let manifest = format!(
            r#"{{"name":"@acme/p","version":"1.0.0","seampact":{{"role":"pack","pack":"{entry}"}}}}"#
        );
        let reader = spy_of(owned(&[
            ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
            ("node_modules/@acme/p/package.json", &manifest),
        ]));
        let load = run_on(&reader, "api.yaml");

        assert_eq!(load.rules(), [rule], "{entry}");
        assert_eq!(
            reader.reads(),
            ["api.yaml", "node_modules/@acme/p/package.json"],
            "{entry}"
        );
    }
}

#[test]
fn a_package_json_linked_out_of_its_package_is_refused_and_never_read() {
    let reader = SpyReader::new(
        MemoryReader::new(owned(&[
            ("api.yaml", "api: { name: t }\npacks: ['@acme/p']\n"),
            (
                "node_modules/@acme/p/pack.yaml",
                "pack: { name: '@acme/p', version: 1.0.0 }\n",
            ),
            (
                "elsewhere/package.json",
                r#"{"name":"@acme/p","version":"1.0.0","seampact":{"role":"pack","pack":"pack.yaml"}}"#,
            ),
        ]))
        .with_links([(
            "node_modules/@acme/p/package.json".to_owned(),
            "elsewhere/package.json".to_owned(),
        )]),
    );
    let load = run_on(&reader, "api.yaml");

    assert_eq!(load.rules(), ["path-escape"]);
    assert_eq!(reader.reads(), ["api.yaml"]);
    assert!(!load.printed().contains("elsewhere"));
}

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

#[test]
fn an_include_fan_out_stops_at_the_expansion_limit_through_the_whole_load() {
    let load = run_on(&MemoryReader::new(fan_out(18)), "api.yaml");

    assert_eq!(load.rules(), ["expansion-limit"]);
    assert!(
        load.diagnostic(0)
            .message
            .contains(&format!("more than {LOAD_MAX_WORK} units of work"))
    );
}

#[test]
fn the_apis_left_after_the_limit_are_not_loaded() {
    let mut files = fan_out(18);

    files[0].1 = "api: { name: one }\nx:\n  $include: ./f0.yaml\n".to_owned();
    files.push((
        "workspace.yaml".to_owned(),
        "workspace:\n  apis: { one: ./api.yaml, two: ./two.yaml }\n".to_owned(),
    ));
    files.push(("two.yaml".to_owned(), "api: { name: wrong }\n".to_owned()));

    let load = run_on(&MemoryReader::new(files), "workspace.yaml");

    assert_eq!(load.rules(), ["expansion-limit"]);
}
