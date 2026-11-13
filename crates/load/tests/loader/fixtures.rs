//! The loader fixtures: each is loaded from disk, its diagnostics printed and compared with its
//! `expected.txt`.

use std::fs;

use super::harness::{Load, fixture_directory, run_fixture};

fn golden(name: &str, rules: &[&str]) -> Load {
    let load = run_fixture(name);
    let expected = fs::read_to_string(fixture_directory(name).join("expected.txt"))
        .expect("the fixture has an expected.txt");

    assert_eq!(format!("{}\n", load.printed()), expected, "{name}");
    assert_eq!(load.rules(), rules, "{name}");

    load
}

#[test]
fn an_extends_conflict_names_both_locations() {
    let load = golden("composition/extends-conflict", &["declaration-twice"]);

    assert_eq!(load.diagnostic(0).related.len(), 1);
}

#[test]
fn an_identical_redefinition_is_refused_too() {
    golden("composition/extends-identical", &["declaration-twice"]);
}

#[test]
fn a_pack_holding_more_than_pack_keys_is_refused() {
    golden("composition/pack-not-data", &["pack-not-data"]);
}

#[test]
fn a_pack_extends_cycle_names_every_file() {
    golden("composition/pack-cycle", &["pack-cycle"]);
}

#[test]
fn a_missing_file_directive_is_a_located_error() {
    golden("composition/file-missing", &["file-missing"]);
}

#[test]
fn bad_paths_are_each_refused_with_their_fix() {
    golden(
        "composition/paths-refused",
        &[
            "path-escape",
            "path-absolute",
            "path-backslash",
            "path-case",
        ],
    );
}

#[test]
fn a_layer_sees_only_itself_and_what_it_builds_on() {
    golden("composition/layer-visibility", &["name-not-visible"]);
}

#[test]
fn inline_and_included_routes_give_the_same_raw_tree() {
    let inline = run_fixture("byte-identity/inline");
    let included = run_fixture("byte-identity/included");

    inline.assert_clean();
    included.assert_clean();
    assert_eq!(included.merged_text(0), inline.merged_text(0));
    assert_eq!(
        serde_json::to_string(&included.api(0).leaf_origins).expect("origins"),
        serde_json::to_string(&inline.api(0).leaf_origins).expect("origins")
    );
    assert_eq!(
        included
            .api_location(0, "api#/surfaces/app/routes/tasks/routes/search/method")
            .file,
        "routes/search.yaml"
    );
}

#[test]
fn a_query_field_named_default_is_not_a_data_position() {
    let load = golden("composition/data-positions", &[]);
    let listed = load.merged(0)["surfaces"]["app"]["routes"]["tasks"].clone();

    assert_eq!(
        listed["query"],
        serde_json::json!({ "default": { "type": "string", "maxLength": 20 } })
    );
    assert_eq!(
        listed["examples"],
        serde_json::json!({
            "raw": { "status": 200, "value": { "$include": "./never-read.yaml" } }
        })
    );
    assert!(
        !load
            .output
            .read_files
            .iter()
            .any(|file| file == "never-read.yaml")
    );
}

#[test]
fn the_pitfall_fixtures_print_as_their_expected_text() {
    for name in ["p1-boolean-case", "p1-key", "data-null", "p2-dots"] {
        let path = format!("pitfalls/{name}");
        let load = run_fixture(&path);
        let expected =
            fs::read_to_string(fixture_directory(&path).join("expected.txt")).expect("expected");

        assert_eq!(format!("{}\n", load.printed()), expected, "{path}");
    }
}
