//! The editor names and the specialised schemas, through the public API.

use camino::Utf8Path;
use seampact_editor_schemas::{
    EditorCatalogue, EditorDeclaration, EditorNames, EditorSchemaFile, editor_names,
    editor_schema_files,
};
use seampact_js::cmp_utf16;

fn declaration(catalogue: &str, name: &str, file: &str, line: u32) -> EditorDeclaration {
    EditorDeclaration {
        catalogue: catalogue.to_owned(),
        name: name.to_owned(),
        file: file.to_owned(),
        line,
    }
}

fn sentence_of(names: &EditorNames, catalogue: EditorCatalogue, name: &str) -> Option<String> {
    names.get(&catalogue)?.get(name).cloned()
}

#[test]
fn a_pack_names_its_entries_by_pack_not_by_install_path() {
    let cases = [
        (
            "../../node_modules/@seampact/pack-api-platform/pack.yaml",
            "Declared in the pack @seampact/pack-api-platform.",
        ),
        (
            "node_modules/plain/pack.yaml",
            "Declared in the pack plain.",
        ),
        (
            "a/node_modules/x/node_modules/y/pack.yaml",
            "Declared in the pack x.",
        ),
        (
            "anode_modules/x/pack.yaml",
            "Declared in anode_modules/x/pack.yaml line 4.",
        ),
        (
            "node_modules/@scope/pack.yaml",
            "Declared in the pack @scope.",
        ),
        (
            "node_modules/pack.yaml",
            "Declared in node_modules/pack.yaml line 4.",
        ),
    ];

    for (file, expected) in cases {
        let names = editor_names(&[declaration("rights", "page.read", file, 4)]);

        assert_eq!(
            sentence_of(&names, EditorCatalogue::Rights, "page.read").as_deref(),
            Some(expected),
            "file {file:?}"
        );
    }
}

#[test]
fn sites_are_deduplicated_and_ordered_by_utf16_file_then_line() {
    let names = editor_names(&[
        declaration("schemas", "Note", "\u{1F600}.yaml", 1),
        declaration("schemas", "Note", "\u{FFFF}.yaml", 9),
        declaration("schemas", "Note", "\u{FFFF}.yaml", 2),
        declaration("schemas", "Note", "\u{FFFF}.yaml", 2),
    ]);

    assert_eq!(
        sentence_of(&names, EditorCatalogue::Schemas, "Note").as_deref(),
        Some("Declared in \u{1F600}.yaml line 1; \u{FFFF}.yaml line 2; \u{FFFF}.yaml line 9.")
    );
}

#[test]
fn names_are_sorted_by_utf16_code_units() {
    let names = editor_names(&[
        declaration("enums", "\u{FFFF}", "a.yaml", 1),
        declaration("enums", "\u{1F600}", "a.yaml", 2),
        declaration("enums", "B", "a.yaml", 3),
    ]);
    let listed: Vec<&str> = names
        .get(&EditorCatalogue::Enums)
        .into_iter()
        .flat_map(|by_name| by_name.keys().map(String::as_str))
        .collect();

    assert_eq!(listed, ["B", "\u{1F600}", "\u{FFFF}"]);
    assert!(cmp_utf16("\u{1F600}", "\u{FFFF}").is_lt());
}

#[test]
fn a_catalogue_the_editor_does_not_list_is_skipped() {
    let names = editor_names(&[declaration("rules", "r", "a.yaml", 1)]);

    assert_eq!(
        names.len(),
        1,
        "only the errors catalogue, for the core codes"
    );
    assert!(names.contains_key(&EditorCatalogue::Errors));
}

#[test]
fn the_core_error_codes_are_listed_and_extend_a_declared_sentence() {
    let names = editor_names(&[declaration("errors", "api.internal", "a.yaml", 7)]);
    let internal = sentence_of(&names, EditorCatalogue::Errors, "api.internal");

    assert!(
        internal.as_deref().is_some_and(|text| text.starts_with(
            "Declared in a.yaml line 7. Supplied by seampact: the default code of the "
        )),
        "got {internal:?}"
    );
}

#[test]
fn an_empty_catalogue_leaves_its_position_keyword_only() -> Result<(), Box<dyn std::error::Error>> {
    let files = editor_schema_files(&EditorNames::new())?;

    assert_eq!(files.len(), 25);

    for file in files {
        assert!(!file.text.contains("\"enum\": []"), "{}", file.file_name);
        assert!(file.text.ends_with("}\n"), "{}", file.file_name);
    }

    Ok(())
}

#[test]
fn a_name_position_lists_the_names_with_their_sentences() -> Result<(), Box<dyn std::error::Error>>
{
    let names = editor_names(&[declaration("identities", "user", "api.yaml", 3)]);
    let files = editor_schema_files(&names)?;
    let api = files
        .iter()
        .find(|file| file.file_name == "api.schema.json")
        .ok_or("no api schema")?;

    assert!(api.text.contains("\"Declared in api.yaml line 3.\""));
    assert!(api.text.contains("\"enumDescriptions\""));

    Ok(())
}

#[test]
fn a_file_name_that_leaves_the_directory_is_refused() {
    let escaping = EditorSchemaFile {
        file_name: "../api.schema.json".to_owned(),
        text: String::new(),
    };
    let directory = Utf8Path::new("schemas");

    for (file, expected) in [
        (&escaping, None),
        (
            &EditorSchemaFile {
                file_name: "api.schema.json".to_owned(),
                text: String::new(),
            },
            Some("schemas/api.schema.json"),
        ),
    ] {
        let path = file.path_in(directory).ok();

        assert_eq!(
            path.as_deref().map(Utf8Path::as_str),
            expected,
            "file {}",
            file.file_name
        );
    }
}
