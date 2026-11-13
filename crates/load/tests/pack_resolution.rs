//! Where a pack's files are looked for and what keeps them inside their package.

use seampact_load::{
    LoadReader, LoadText, MemoryReader, PathProblem, is_inside, pack_file_parts, pack_layer_id_of,
    split_pack_file,
};

mod support;

use support::{Outcome, resolve_in};

const PACK_MANIFEST: &str = "pack: { name: '@acme/pack-a', version: 1.2.0 }\n";

fn files_of(entries: &[(&str, &str)]) -> Vec<(String, String)> {
    entries
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect()
}

fn links_of(entries: &[(&str, &str)]) -> Vec<(String, String)> {
    files_of(entries)
}

#[test]
fn a_pack_in_the_root_node_modules_is_found_inside_its_package() {
    let reader = MemoryReader::new(files_of(&[
        ("api.yaml", "api: { name: t }\n"),
        ("node_modules/@acme/pack-a/lib/pack.yaml", PACK_MANIFEST),
    ]));
    let package = "node_modules/@acme/pack-a";

    assert_eq!(
        resolve_in(
            &reader,
            "api.yaml",
            "./node_modules/@acme/pack-a/lib/pack.yaml",
            "."
        ),
        Outcome::Real("node_modules/@acme/pack-a/lib/pack.yaml".to_owned())
    );
    assert_eq!(
        resolve_in(
            &reader,
            "node_modules/@acme/pack-a/lib/pack.yaml",
            "./pack.yaml",
            package
        ),
        Outcome::Real("node_modules/@acme/pack-a/lib/pack.yaml".to_owned())
    );
}

#[test]
fn a_pack_in_a_node_modules_above_the_root_is_found_inside_its_package() {
    let reader = MemoryReader::new(files_of(&[
        ("api.yaml", "api: { name: t }\n"),
        ("../node_modules/@acme/pack-a/lib/pack.yaml", PACK_MANIFEST),
    ]));
    let package = "../node_modules/@acme/pack-a";

    assert_eq!(
        resolve_in(
            &reader,
            "../node_modules/@acme/pack-a/lib/pack.yaml",
            "./pack.yaml",
            package
        ),
        Outcome::Real("../node_modules/@acme/pack-a/lib/pack.yaml".to_owned())
    );
    assert_eq!(
        split_pack_file("../node_modules/@acme/pack-a/lib/pack.yaml"),
        Some(("../node_modules/@acme/pack-a", "lib/pack.yaml"))
    );
}

#[test]
fn a_package_that_is_not_installed_is_missing() {
    let reader = MemoryReader::new(files_of(&[("api.yaml", "api: { name: t }\n")]));

    assert_eq!(
        resolve_in(
            &reader,
            "api.yaml",
            "./node_modules/@acme/pack-a/lib/pack.yaml",
            "."
        ),
        Outcome::Missing
    );
    assert_eq!(reader.real_path("node_modules/@acme/pack-a"), None);
}

#[test]
fn through_a_symlinked_package_the_pack_stays_inside_its_package() {
    let reader = MemoryReader::new(files_of(&[
        ("api.yaml", "api: { name: t }\n"),
        ("store/@acme/pack-a/package.json", "{}"),
        ("store/@acme/pack-a/lib/pack.yaml", PACK_MANIFEST),
        ("store/@acme/pack-a/lib/part.yaml", "rights: {}\n"),
    ]))
    .with_links(links_of(&[(
        "node_modules/@acme/pack-a",
        "store/@acme/pack-a",
    )]));
    let package = "node_modules/@acme/pack-a";

    assert_eq!(
        resolve_in(
            &reader,
            "node_modules/@acme/pack-a/lib/pack.yaml",
            "./part.yaml",
            package
        ),
        Outcome::Real("store/@acme/pack-a/lib/part.yaml".to_owned())
    );
    assert!(is_inside(
        "store/@acme/pack-a",
        "store/@acme/pack-a/lib/part.yaml"
    ));
}

#[test]
fn a_pack_path_that_leaves_its_package_is_refused() {
    let reader = MemoryReader::new(files_of(&[
        ("api.yaml", "api: { name: t }\n"),
        ("node_modules/@acme/pack-a/lib/pack.yaml", PACK_MANIFEST),
        ("node_modules/@acme/pack-b/x.yaml", ""),
    ]));
    let package = "node_modules/@acme/pack-a";
    let from = "node_modules/@acme/pack-a/lib/pack.yaml";

    assert_eq!(
        resolve_in(&reader, from, "../../../../api.yaml", package),
        Outcome::Refused(PathProblem::Escape)
    );
    assert_eq!(
        resolve_in(&reader, from, "../../pack-b/x.yaml", package),
        Outcome::Refused(PathProblem::Escape)
    );
}

#[test]
fn a_link_inside_a_pack_to_a_file_outside_its_package_is_refused() {
    let reader = MemoryReader::new(files_of(&[
        ("api.yaml", "stolen: 1\n"),
        ("node_modules/@acme/pack-a/lib/pack.yaml", PACK_MANIFEST),
    ]))
    .with_links(links_of(&[(
        "node_modules/@acme/pack-a/lib/out.yaml",
        "api.yaml",
    )]));
    let package = "node_modules/@acme/pack-a";

    assert_eq!(
        resolve_in(
            &reader,
            "node_modules/@acme/pack-a/lib/pack.yaml",
            "./out.yaml",
            package
        ),
        Outcome::Escaped
    );
    assert_eq!(
        reader.read_text("node_modules/@acme/pack-a/lib/out.yaml", 100),
        Some(LoadText::Text("stolen: 1\n".to_owned()))
    );
}

#[test]
fn a_pack_file_names_its_package_and_its_layer() {
    let parts = pack_file_parts("../node_modules/@acme/pack-a/lib/pack.yaml");

    assert_eq!(parts.map(|parts| parts.name), Some("@acme/pack-a"));
    assert_eq!(
        pack_layer_id_of("@acme/pack-a").to_string(),
        "pack:@acme/pack-a"
    );
}
