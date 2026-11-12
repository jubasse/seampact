//! The bundled JSON Schemas never use the `multipleOf` keyword.
//!
//! `jsonschema` checks `multipleOf` on exact decimals where Ajv checked `f64`s (`0.3` is a multiple
//! of `0.1` for one and not the other), so the keyword would change validation results.

mod support;

use std::fs;

use seampact_json::{JsonValue, escape_pointer};
use support::{files_under, repository_root};

/// The bundled schemas: authoring, bundle, config and IR.
const SCHEMAS_DIRECTORY: &str = "packages/core/spec/schemas";

const SCHEMA_FILE_SUFFIX: &str = ".schema.json";

const MULTIPLE_OF_KEYWORD: &str = "multipleOf";

/// Keywords whose value maps names to subschemas: the names are data, not keywords.
const NAME_TO_SCHEMA_KEYWORDS: [&str; 5] = [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
];

/// Keywords whose value is data, never a schema.
const DATA_KEYWORDS: [&str; 5] = ["const", "enum", "default", "examples", "required"];

/// Where a schema object is reached from.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Position {
    Schema,
    NameToSchemaMap,
}

fn multiple_of_pointers(
    value: &JsonValue,
    pointer: &str,
    position: Position,
    found: &mut Vec<String>,
) {
    match value {
        JsonValue::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                multiple_of_pointers(item, &format!("{pointer}/{index}"), Position::Schema, found);
            }
        }
        JsonValue::Object(members) => {
            if position == Position::Schema && members.contains_key(MULTIPLE_OF_KEYWORD) {
                found.push(format!("{pointer}/{MULTIPLE_OF_KEYWORD}"));
            }

            for (name, member) in members {
                let is_data =
                    position == Position::Schema && DATA_KEYWORDS.contains(&name.as_str());
                let member_position = if position == Position::Schema
                    && NAME_TO_SCHEMA_KEYWORDS.contains(&name.as_str())
                {
                    Position::NameToSchemaMap
                } else {
                    Position::Schema
                };

                if !is_data {
                    multiple_of_pointers(
                        member,
                        &format!("{pointer}/{}", escape_pointer(name)),
                        member_position,
                        found,
                    );
                }
            }
        }
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {}
    }
}

#[test]
fn no_bundled_schema_uses_the_multiple_of_keyword() {
    let schema_files = files_under(&repository_root().join(SCHEMAS_DIRECTORY), &|path| {
        path.to_string_lossy().ends_with(SCHEMA_FILE_SUFFIX)
    })
    .unwrap();
    let mut keyword_places = Vec::new();

    for schema_file in &schema_files {
        let schema: JsonValue =
            serde_json::from_str(&fs::read_to_string(schema_file).unwrap()).unwrap();
        let mut pointers = Vec::new();

        multiple_of_pointers(&schema, "", Position::Schema, &mut pointers);
        keyword_places.extend(
            pointers
                .into_iter()
                .map(|pointer| format!("{}#{pointer}", schema_file.display())),
        );
    }

    assert!(
        !schema_files.is_empty(),
        "no schema found under {SCHEMAS_DIRECTORY}"
    );
    assert_eq!(keyword_places, Vec::<String>::new());
}

#[test]
fn the_keyword_is_found_and_a_property_of_that_name_is_not() {
    let schema: JsonValue = serde_json::from_str(
        r#"{"properties": {"multipleOf": {"type": "number"}}, "$defs": {"step": {"multipleOf": 0.1}}, "default": {"multipleOf": 1}}"#,
    )
    .unwrap();
    let mut pointers = Vec::new();

    multiple_of_pointers(&schema, "", Position::Schema, &mut pointers);

    assert_eq!(pointers, ["/$defs/step/multipleOf"]);
}
