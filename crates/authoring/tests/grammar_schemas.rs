//! The grammar constants match the embedded authoring schemas: the markers and editor titles
//! are exactly the titles the schemas write, the data positions are the ones marked, the keyword
//! table is what the schema language decides, and the keyword set of every mapping is
//! the committed grammar snapshot.

use std::collections::BTreeSet;

use seampact_authoring::{
    AUTHORING_SCHEMA_FILES, DATA, EDITOR_TITLES, EXTENSION_KEY, MARKERS, Marker, RESERVED_NAMES,
    SCHEMA_KEYWORDS, SchemaKeywordDecision, refused_schema_keywords,
};
use seampact_json::{JsonObject, JsonValue, escape_pointer};

/// The grammar snapshot the TypeScript grammar test writes.
const GRAMMAR_SNAPSHOT: &str =
    include_str!("../../../packages/core/spec/src/authoring/grammar.snapshot.json");

/// The TypeScript keyword table, the source of every `reason` and `fix` the schemas do not carry.
const KEYWORDS_SOURCE: &str = include_str!("../../../packages/core/spec/src/authoring/keywords.ts");

/// The schema-language keywords seampact adds to the 2020-12 vocabularies (ADR 0003 sections 2
/// to 6) and the `$include` loader directive: the `plain` properties outside the keyword table.
const SEAMPACT_SCHEMA_KEYWORDS: [&str; 11] = [
    "$include",
    "codeName",
    "discriminator",
    "file",
    "lint",
    "nullable",
    "opaque",
    "restrictedTo",
    "sensitive",
    "typeName",
    "unknownKeys",
];

/// The schema-language definition of a plain schema.
const PLAIN_DEFINITION: &str = "plain";

/// The schema-language definition of a schema that is a `$ref` with marks and annotations.
const REFERENCE_DEFINITION: &str = "referenceMapping";

/// The section every refused form shows: ADR 0003 section 1 decides each refused form.
const REFUSED_FORM_SECTION: &str = "ADR 0003 section 1";

/// The key under which `grammar_keywords` records a mapping's extension keys.
const EXTENSION_KEYWORD: &str = "x-<prefix>-<key>";

/// Each embedded schema file, by kind, parsed.
#[expect(
    clippy::panic,
    reason = "an embedded schema that is no JSON fails the test"
)]
fn parsed_schemas() -> Vec<(&'static str, JsonValue)> {
    AUTHORING_SCHEMA_FILES
        .iter()
        .map(|schema_file| {
            let schema = serde_json::from_str(schema_file.text)
                .unwrap_or_else(|error| panic!("{}: {error}", schema_file.file_name));

            (schema_file.kind, schema)
        })
        .collect()
}

fn as_object(value: &JsonValue) -> Option<&JsonObject> {
    match value {
        JsonValue::Object(object) => Some(object),
        _ => None,
    }
}

/// Every string `title` keyword under `node`: a member named `title` with a non-string value is a
/// property named `title`, searched like any other value.
fn titles(node: &JsonValue, found: &mut BTreeSet<String>) {
    match node {
        JsonValue::Array(items) => items.iter().for_each(|item| titles(item, found)),
        JsonValue::Object(object) => {
            for (key, child) in object {
                match child {
                    JsonValue::String(title) if key == "title" => {
                        found.insert(title.clone());
                    }
                    _ => titles(child, found),
                }
            }
        }
        _ => {}
    }
}

fn data_pointers(node: &JsonValue, location: &str, found: &mut Vec<String>) {
    match node {
        JsonValue::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                data_pointers(item, &format!("{location}/{index}"), found);
            }
        }
        JsonValue::Object(object) => {
            if object.get("title") == Some(&JsonValue::String(DATA.to_owned())) {
                found.push(location.to_owned());
            }

            for (key, child) in object {
                if key != "title" {
                    data_pointers(child, &format!("{location}/{key}"), found);
                }
            }
        }
        _ => {}
    }
}

#[test]
fn every_marker_appears_in_the_schemas() {
    let mut found = BTreeSet::new();

    for (_, schema) in parsed_schemas() {
        titles(&schema, &mut found);
    }

    let missing: Vec<&str> = MARKERS
        .iter()
        .map(|marker| marker.title())
        .filter(|title| !found.contains(*title))
        .collect();

    assert_eq!(missing, Vec::<&str>::new());
}

#[test]
fn every_title_below_a_file_root_is_a_marker_an_editor_title_or_data() {
    let mut found = BTreeSet::new();

    for (file, schema) in parsed_schemas() {
        let mut below_root = as_object(&schema)
            .unwrap_or_else(|| panic!("{file}"))
            .clone();

        below_root.remove("title");
        titles(&JsonValue::Object(below_root), &mut found);
    }

    let unknown: Vec<&String> = found
        .iter()
        .filter(|title| {
            Marker::from_title(title).is_none()
                && !EDITOR_TITLES.contains(&title.as_str())
                && title.as_str() != DATA
        })
        .collect();
    let unused_editor_titles: Vec<&str> = EDITOR_TITLES
        .into_iter()
        .filter(|title| !found.contains(*title))
        .collect();

    assert_eq!(unknown, Vec::<&String>::new());
    assert_eq!(unused_editor_titles, Vec::<&str>::new());
}

#[test]
fn the_data_positions_are_the_ones_marked_data() {
    let mut found = Vec::new();

    for (file, schema) in parsed_schemas() {
        data_pointers(&schema, file, &mut found);
    }

    found.sort();

    assert_eq!(
        found,
        [
            "errors/$defs/entry/properties/example",
            "node-errors/$defs/attachment/else/properties/example",
            "node-errors/$defs/attachment/then/properties/example",
            "node/$defs/examples/additionalProperties/properties/value",
            "schema/$defs/derived/properties/examples/items",
            "schema/$defs/overlay/properties/default",
            "schema/$defs/overlay/properties/examples/items",
            "schema/$defs/plain/properties/default",
            "schema/$defs/plain/properties/examples/items",
            "schema/$defs/referenceMapping/properties/default",
            "schema/$defs/referenceMapping/properties/examples/items",
        ]
    );
}

#[test]
fn the_reserved_names_are_refused_as_map_keys() {
    let reserved: Vec<JsonValue> = RESERVED_NAMES
        .into_iter()
        .map(|name| JsonValue::String(name.to_owned()))
        .collect();
    let schemas = parsed_schemas();
    let refusing_files: Vec<&str> = schemas
        .iter()
        .filter(|(_, schema)| holds_not_enum(schema, &reserved))
        .map(|(file, _)| *file)
        .collect();

    assert!(refusing_files.contains(&"common"), "{refusing_files:?}");
}

/// Whether some node under `node` is `{ not: { enum: <names> } }`.
fn holds_not_enum(node: &JsonValue, names: &[JsonValue]) -> bool {
    match node {
        JsonValue::Array(items) => items.iter().any(|item| holds_not_enum(item, names)),
        JsonValue::Object(object) => {
            let refuses_names = object
                .get("not")
                .and_then(as_object)
                .and_then(|not| not.get("enum"))
                == Some(&JsonValue::Array(names.to_vec()));

            refuses_names || object.values().any(|child| holds_not_enum(child, names))
        }
        _ => false,
    }
}

/// The properties of `definition` in the schema language.
#[expect(
    clippy::expect_used,
    reason = "a schema language without the definition fails the test"
)]
fn schema_language_properties(definition: &str) -> JsonObject {
    let schemas = parsed_schemas();
    let (_, schema_language) = schemas
        .iter()
        .find(|(file, _)| *file == "schema")
        .expect("the schema language file is embedded");

    as_object(schema_language)
        .and_then(|root| root.get("$defs"))
        .and_then(as_object)
        .and_then(|definitions| definitions.get(definition))
        .and_then(as_object)
        .and_then(|definition_schema| definition_schema.get("properties"))
        .and_then(as_object)
        .cloned()
        .expect("schema.schema.json has the definition, with properties")
}

/// The keyword properties of the schema language: the `plain` definition decides every keyword
/// but `$ref`, which only a reference mapping holds.
fn keyword_properties() -> JsonObject {
    let mut properties = schema_language_properties(PLAIN_DEFINITION);

    for (keyword, property) in schema_language_properties(REFERENCE_DEFINITION) {
        if !properties.contains_key(&keyword) {
            properties.insert(keyword, property);
        }
    }

    properties
}

fn string_member<'object>(object: &'object JsonObject, key: &str) -> Option<&'object str> {
    match object.get(key)? {
        JsonValue::String(text) => Some(text),
        _ => None,
    }
}

/// The text a refused keyword or form shows: its section, reason and fix.
fn refusal_text(section: &str, reason: &str, fix: &str) -> String {
    format!("Refused ({section}): {reason}. Fix: {fix}.")
}

#[test]
fn the_keyword_table_and_the_schema_language_decide_the_same_keywords() {
    let properties_by_keyword = keyword_properties();
    let table: BTreeSet<&str> = SCHEMA_KEYWORDS.iter().map(|entry| entry.keyword).collect();
    let schema_language: BTreeSet<&str> = properties_by_keyword
        .keys()
        .map(String::as_str)
        .filter(|keyword| !SEAMPACT_SCHEMA_KEYWORDS.contains(keyword))
        .collect();

    assert_eq!(table.len(), SCHEMA_KEYWORDS.len());
    assert_eq!(table, schema_language);
}

#[test]
fn every_keyword_carries_its_section_and_each_refusal_its_text() {
    let properties_by_keyword = keyword_properties();

    for entry in SCHEMA_KEYWORDS {
        let property = properties_by_keyword
            .get(entry.keyword)
            .and_then(as_object)
            .unwrap_or_else(|| panic!("plain has no property {}", entry.keyword));

        assert_eq!(
            string_member(property, "$comment"),
            Some(entry.section),
            "{}",
            entry.keyword
        );

        let titled_refused = string_member(property, "title") == Some(Marker::Refused.title());

        assert_eq!(
            entry.decision == SchemaKeywordDecision::Refused,
            titled_refused,
            "{}",
            entry.keyword
        );

        if entry.decision == SchemaKeywordDecision::Refused {
            let shown = refusal_text(entry.section, entry.reason, entry.fix);

            assert_eq!(
                string_member(property, "title"),
                Some(Marker::Refused.title())
            );
            assert_eq!(
                property.get("not"),
                Some(&JsonValue::Object(JsonObject::new()))
            );
            assert_eq!(
                string_member(property, "description"),
                Some(shown.as_str()),
                "{}",
                entry.keyword
            );
        }
    }
}

#[test]
fn every_refused_form_is_shown_with_its_reason_and_fix() {
    let properties_by_keyword = keyword_properties();

    for entry in SCHEMA_KEYWORDS {
        let property = properties_by_keyword
            .get(entry.keyword)
            .expect("a kept keyword is a property");
        let mut shown = Vec::new();

        refused_form_descriptions(property, &mut shown);

        let expected: Vec<String> = entry
            .refused_form
            .map(|refused_form| {
                refusal_text(REFUSED_FORM_SECTION, refused_form.reason, refused_form.fix)
            })
            .into_iter()
            .collect();

        assert_eq!(shown, expected, "{}", entry.keyword);
    }

    let refused_count = refused_schema_keywords().count();

    assert!(refused_count > 0 && refused_count < SCHEMA_KEYWORDS.len());
}

/// The description of each node titled `refused form` under `node`.
fn refused_form_descriptions(node: &JsonValue, found: &mut Vec<String>) {
    match node {
        JsonValue::Array(items) => {
            for item in items {
                refused_form_descriptions(item, found);
            }
        }
        JsonValue::Object(object) => {
            if string_member(object, "title") == Some(Marker::RefusedForm.title()) {
                found.push(
                    string_member(object, "description")
                        .unwrap_or("")
                        .to_owned(),
                );
            }

            for child in object.values() {
                refused_form_descriptions(child, found);
            }
        }
        _ => {}
    }
}

/// The keyword set of each mapping of the grammar, and the keywords that name no ADR section:
/// the port of the TypeScript `grammarKeywords`.
struct GrammarKeywords {
    /// `<file>#<pointer of the mapping>` to keyword to ADR section.
    mappings: JsonObject,
    /// Keywords whose `$comment` names no ADR section.
    unreferenced: Vec<String>,
}

#[expect(
    clippy::unwrap_used,
    reason = "an embedded schema that is no JSON fails the test"
)]
fn grammar_keywords() -> GrammarKeywords {
    let mut grammar = GrammarKeywords {
        mappings: JsonObject::new(),
        unreferenced: Vec::new(),
    };

    for schema_file in AUTHORING_SCHEMA_FILES {
        let schema: JsonValue = serde_json::from_str(schema_file.text).unwrap();

        visit(
            &schema,
            &format!("{}#", schema_file.file_name),
            &mut grammar,
        );
    }

    grammar
}

fn visit(node: &JsonValue, location: &str, grammar: &mut GrammarKeywords) {
    if let JsonValue::Array(items) = node {
        for (index, item) in items.iter().enumerate() {
            visit(item, &format!("{location}/{index}"), grammar);
        }

        return;
    }

    let Some(schema) = as_object(node) else {
        return;
    };

    let closed = schema.get("additionalProperties") == Some(&JsonValue::Bool(false));

    if let (true, Some(JsonValue::Object(properties))) = (closed, schema.get("properties")) {
        let keywords = mapping_keywords(schema, properties, location, grammar);

        grammar
            .mappings
            .insert(location.to_owned(), JsonValue::Object(keywords));
    }

    for (key, child) in schema {
        visit(
            child,
            &format!("{location}/{}", escape_pointer(key)),
            grammar,
        );
    }
}

#[expect(
    clippy::expect_used,
    reason = "an extension key pattern without its section fails the test"
)]
fn mapping_keywords(
    schema: &JsonObject,
    properties: &JsonObject,
    location: &str,
    grammar: &mut GrammarKeywords,
) -> JsonObject {
    let mut keywords = JsonObject::new();

    for (key, value) in properties {
        let property = as_object(value);
        let title = property.and_then(|property| string_member(property, "title"));

        if key == "$include" || title == Some(Marker::Refused.title()) {
            continue;
        }

        match property.and_then(|property| string_member(property, "$comment")) {
            Some(section) if is_adr_reference(section) => {
                keywords.insert(key.clone(), JsonValue::String(section.to_owned()));
            }
            _ => grammar.unreferenced.push(format!("{location}: {key}")),
        }
    }

    let extension_comment = schema
        .get("patternProperties")
        .and_then(as_object)
        .and_then(|patterns| patterns.get(EXTENSION_KEY))
        .map(|extension| {
            as_object(extension)
                .and_then(|e| e.get("$comment"))
                .cloned()
        });

    if let Some(comment) = extension_comment {
        let section = comment.expect("an extension key pattern names its ADR section");

        keywords.insert(EXTENSION_KEYWORD.to_owned(), section);
    }

    keywords
}

/// `^ADR \d{4}( section \d+)?$`.
fn is_adr_reference(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("ADR ") else {
        return false;
    };
    let is_digits = |digits: &str| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
    let (number, section) = match rest.split_once(" section ") {
        Some((number, section)) => (number, Some(section)),
        None => (rest, None),
    };

    number.len() == 4 && is_digits(number) && section.is_none_or(is_digits)
}

#[test]
fn every_grammar_keyword_names_its_adr_section() {
    assert_eq!(grammar_keywords().unreferenced, Vec::<String>::new());
}

#[test]
fn the_grammar_keywords_match_the_committed_snapshot() {
    let snapshot: JsonValue = serde_json::from_str(GRAMMAR_SNAPSHOT).unwrap();
    let mappings = grammar_keywords().mappings;
    let snapshot_mappings = as_object(&snapshot).expect("the snapshot is an object");

    assert_eq!(
        mappings.keys().collect::<Vec<_>>(),
        snapshot_mappings.keys().collect::<Vec<_>>()
    );
    assert_eq!(JsonValue::Object(mappings), snapshot);
}

#[test]
fn adr_references_follow_the_pattern() {
    for accepted in ["ADR 0002", "ADR 0003 section 1", "ADR 0002 section 12"] {
        assert!(is_adr_reference(accepted), "{accepted}");
    }

    for refused in [
        "ADR 002",
        "ADR 00021",
        "ADR 0002 section",
        "ADR 0002 section x",
        "ADR 0002 section 1 ",
        "adr 0002",
        "",
    ] {
        assert!(!is_adr_reference(refused), "{refused}");
    }
}

/// The text of the TypeScript table entry of `keyword`, up to the next entry.
fn keyword_source_entry(keyword: &str) -> &'static str {
    let opening = format!("keyword: \"{keyword}\",");
    let (_, from_entry) = KEYWORDS_SOURCE
        .split_once(&opening)
        .unwrap_or_else(|| panic!("keywords.ts has no entry for {keyword}"));

    from_entry
        .split_once("keyword: \"")
        .map_or(from_entry, |(entry, _)| entry)
}

/// `source` with a line break after `reason:` or `fix:` (the formatter's wrap of a long value)
/// folded back to one space.
fn unwrapped_members(source: &str) -> String {
    let trimmed_lines: Vec<&str> = source.lines().map(str::trim).collect();

    trimmed_lines
        .join("\n")
        .replace("reason:\n", "reason: ")
        .replace("fix:\n", "fix: ")
}

/// The two ways the formatter writes `text` as a string literal: double-quoted, or
/// single-quoted when the text holds double quotes and no single quote.
fn typescript_literals(text: &str) -> [String; 2] {
    [
        serde_json::to_string(text).expect("a string serializes"),
        format!("'{text}'"),
    ]
}

/// Whether `source` holds the member `name: <literal of text>`.
fn has_member(source: &str, name: &str, text: &str) -> bool {
    typescript_literals(text)
        .iter()
        .any(|literal| source.contains(&format!("{name}: {literal}")))
}

#[test]
fn every_decision_reason_and_fix_is_the_typescript_text() {
    for entry in SCHEMA_KEYWORDS {
        let source = unwrapped_members(keyword_source_entry(entry.keyword));
        let decision = match entry.decision {
            SchemaKeywordDecision::Kept => "kept",
            SchemaKeywordDecision::Refused => "refused",
        };
        let mut expected_members = vec![
            ("decision", decision),
            ("reason", entry.reason),
            ("fix", entry.fix),
        ];

        if let Some(refused_form) = entry.refused_form {
            expected_members.push(("reason", refused_form.reason));
            expected_members.push(("fix", refused_form.fix));
        }

        for (name, text) in expected_members {
            assert!(
                has_member(&source, name, text),
                "{}: keywords.ts lacks {name}: {text:?}",
                entry.keyword
            );
        }

        assert_eq!(
            source.contains("refusedForm"),
            entry.refused_form.is_some(),
            "{}",
            entry.keyword
        );
    }
}
