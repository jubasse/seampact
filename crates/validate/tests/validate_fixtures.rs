//! The fixtures of `fixtures/validate` run through `validate_document`, as the TypeScript
//! validate tests read them: one file, one expected diagnostic or none.

use std::{error::Error, fs, path::Path, path::PathBuf};

use seampact_authoring::LayerSchemaKind;
use seampact_diagnostics::{Diagnostic, DiagnosticLayer};
use seampact_json::{JsonObject, JsonValue};
use seampact_load::yaml::{ScalarStyle, YamlKind, YamlNode, parse_yaml};
use seampact_span::SourceFiles;
use seampact_validate::{RULE_IDS, ValidateRule, validate_document};

type TestResult = Result<(), Box<dyn Error>>;

const EXPECT_PREFIX: &str = "# expect: ";
const REFUSED_DIRECTORY: &str = "refused";

/// Files brought by `$include`: validated after resolution, through the loader and the oracle.
const INCLUDE_DIRECTORY: &str = "include";
const ACCEPTED_DIRECTORY: &str = "reasons/accepted";
const REFUSED_KEYWORD_POINTER_PREFIX: &str = "/schemas/Task/";

fn validate_fixtures_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/validate")
}

fn yaml_files_below(directory: &Path) -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let mut found = Vec::new();

    for entry in fs::read_dir(directory)? {
        let path = entry?.path();

        if path.is_dir() {
            found.extend(yaml_files_below(&path)?);
        } else {
            found.push(path);
        }
    }

    found.sort();

    Ok(found)
}

fn json_of(node: &YamlNode) -> Result<JsonValue, Box<dyn Error>> {
    match &node.kind {
        YamlKind::Mapping(pairs) => {
            let mut object = JsonObject::new();

            for pair in pairs {
                let Some(key) = pair.key.scalar_text() else {
                    return Err("a fixture key is not a scalar".into());
                };
                let value = match &pair.value {
                    Some(value) => json_of(value)?,
                    None => JsonValue::Null,
                };

                object.insert(key.to_owned(), value);
            }

            Ok(JsonValue::Object(object))
        }
        YamlKind::Sequence(items) => Ok(JsonValue::Array(
            items.iter().map(json_of).collect::<Result<_, _>>()?,
        )),
        YamlKind::Scalar { value, style } => {
            if *style != ScalarStyle::Plain || node.tag.is_some() {
                return Ok(JsonValue::String(value.clone()));
            }

            Ok(node
                .resolved_scalar()
                .ok_or("a scalar without a value")?
                .into_json_value())
        }
        YamlKind::Alias(_) => Err("a fixture uses an alias".into()),
    }
}

fn tree_of(text: &str) -> Result<JsonValue, Box<dyn Error>> {
    let mut files = SourceFiles::new();
    let file = files.add("fixture.yaml", text)?;
    let document = parse_yaml(file, text)?;
    let root = document.root.ok_or("an empty fixture")?;

    json_of(&root)
}

fn check(text: &str) -> Result<(JsonValue, DiagnosticLayer, Vec<Diagnostic>), Box<dyn Error>> {
    let tree = tree_of(text)?;
    let JsonValue::Object(top) = &tree else {
        return Err("a fixture is not a mapping".into());
    };
    let (kind, layer) = if top.get("api").is_some() {
        (LayerSchemaKind::Api, DiagnosticLayer::Api)
    } else if let Some(JsonValue::Object(pack)) = top.get("pack") {
        let name = match pack.get("name") {
            Some(JsonValue::String(name)) => name.clone(),
            _ => String::new(),
        };

        (LayerSchemaKind::Pack, DiagnosticLayer::Pack(name))
    } else {
        (LayerSchemaKind::Base, DiagnosticLayer::Shared)
    };
    let diagnostics = validate_document(kind, &tree, &layer)?;

    Ok((tree, layer, diagnostics))
}

fn expectation(text: &str) -> Result<(String, String), Box<dyn Error>> {
    let first = text.lines().next().unwrap_or_default();
    let rest = first
        .strip_prefix(EXPECT_PREFIX)
        .ok_or("a fixture without '# expect:'")?;
    let (rule, pointer) = rest.split_once(' ').unwrap_or((rest, ""));

    Ok((rule.to_owned(), pointer.to_owned()))
}

#[test]
fn every_fixture_gives_its_expected_diagnostic_or_none() -> TestResult {
    let root = validate_fixtures_directory();
    let mut checked = 0;

    for path in yaml_files_below(&root)? {
        let relative = path
            .strip_prefix(&root)?
            .to_string_lossy()
            .replace('\\', "/");

        if relative.starts_with(REFUSED_DIRECTORY) || relative.starts_with(INCLUDE_DIRECTORY) {
            continue;
        }

        let text = fs::read_to_string(&path)?;
        let (_, _, diagnostics) = check(&text)?;
        let found: Vec<(String, String)> = diagnostics
            .iter()
            .map(|d| (d.rule.as_str().to_owned(), d.origin.pointer.clone()))
            .collect();

        if relative.starts_with(ACCEPTED_DIRECTORY) {
            assert_eq!(found, Vec::new(), "{relative} is accepted without a reason");
        } else {
            assert_eq!(found, vec![expectation(&text)?], "{relative}");
        }

        checked += 1;
    }

    assert!(checked > 30, "only {checked} fixtures were reached");

    Ok(())
}

#[test]
fn every_refused_keyword_fixture_names_its_keyword() -> TestResult {
    let directory = validate_fixtures_directory().join(REFUSED_DIRECTORY);
    let refused_rule = ValidateRule::RefusedKeyword.as_str();
    let mut checked = 0;

    for path in yaml_files_below(&directory)? {
        let keyword = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or("a fixture without a name")?;
        let (_, _, diagnostics) = check(&fs::read_to_string(&path)?)?;
        let found: Vec<(String, String)> = diagnostics
            .iter()
            .map(|d| (d.rule.as_str().to_owned(), d.origin.pointer.clone()))
            .collect();

        assert_eq!(
            found,
            vec![(
                refused_rule.to_owned(),
                format!("{REFUSED_KEYWORD_POINTER_PREFIX}{keyword}")
            )],
            "{keyword}"
        );

        checked += 1;
    }

    assert_eq!(checked, 29);

    Ok(())
}

#[test]
fn a_pack_root_key_says_a_pack_is_data_only() -> TestResult {
    let text = fs::read_to_string(validate_fixtures_directory().join("pack/code.yaml"))?;
    let (_, _, diagnostics) = check(&text)?;

    assert!(
        diagnostics
            .first()
            .is_some_and(|d| d.message.contains("a pack is data only")),
        "{diagnostics:?}"
    );

    Ok(())
}

#[test]
fn every_rule_the_fixtures_expect_is_declared() -> TestResult {
    let root = validate_fixtures_directory();

    for path in yaml_files_below(&root)? {
        let text = fs::read_to_string(&path)?;

        if let Ok((rule, _)) = expectation(&text) {
            assert!(
                RULE_IDS.iter().any(|declared| declared.as_str() == rule),
                "{rule} of {path:?}"
            );
        }
    }

    Ok(())
}
