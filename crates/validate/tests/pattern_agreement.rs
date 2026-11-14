//! The `pattern` keyword of the authoring schemas answers the same under the `jsonschema` crate
//! (what the validate stage runs) and under `regress` (an ECMAScript engine, what Ajv runs).

use std::error::Error;

use regress::Regex;
use seampact_authoring::AUTHORING_SCHEMA_FILES;
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

const UNICODE_FLAGS: &str = "u";

// A floor so a schema walk that finds nothing cannot pass the agreement test.
const MIN_PATTERNS: usize = 5;

/// Inputs on the edges of the engines: line terminators, astral characters, white space.
const EDGE_INPUTS: &[&str] = &[
    "",
    "a",
    "a.b",
    "Tasks",
    "tasks",
    "tasks.read",
    "a-b",
    "a_b",
    "a1",
    "1a",
    "1.2.3",
    "2.1.0",
    "v1",
    "/tasks",
    "/tasks/{id}",
    "a\n",
    "a\r",
    "a\r\n",
    "a\u{2028}",
    "a\u{2029}",
    "\n",
    "\r",
    "\u{2028}",
    "a\nb",
    "a\u{2028}b",
    "\u{1F600}",
    "a\u{1F600}",
    "\u{1F600}a",
    "\u{00E9}",
    "e\u{0301}",
    " a",
    "a ",
    "\u{00A0}",
    "\u{FEFF}a",
    "\u{0085}",
    "\u{FF11}",
    "\u{0660}",
    "@seampact/pack-crud-rights",
    "@a/b",
];

fn collect_patterns(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Object(members) => {
            for (key, member) in members {
                match (key.as_str(), member) {
                    ("pattern", Value::String(pattern)) => found.push(pattern.clone()),
                    _ => collect_patterns(member, found),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_patterns(item, found);
            }
        }
        _ => {}
    }
}

fn authoring_patterns() -> Result<Vec<String>, Box<dyn Error>> {
    let mut found = Vec::new();

    for file in AUTHORING_SCHEMA_FILES {
        collect_patterns(&serde_json::from_str(file.text)?, &mut found);
    }

    found.sort();
    found.dedup();

    Ok(found)
}

#[test]
fn the_authoring_schemas_declare_patterns() -> TestResult {
    let patterns = authoring_patterns()?;

    assert!(
        patterns.len() >= MIN_PATTERNS,
        "{} patterns",
        patterns.len()
    );

    Ok(())
}

#[test]
fn jsonschema_and_regress_agree_on_every_authoring_pattern() -> TestResult {
    let mut divergences = Vec::new();

    for pattern in authoring_patterns()? {
        let validator =
            jsonschema::validator_for(&json!({ "type": "string", "pattern": pattern }))?;
        let ecmascript = Regex::with_flags(&pattern, UNICODE_FLAGS)?;

        for input in EDGE_INPUTS {
            let by_jsonschema = validator.is_valid(&json!(input));
            let by_regress = ecmascript.find(input).is_some();

            if by_jsonschema != by_regress {
                divergences.push(format!(
                    "pattern {pattern:?} on {input:?}: jsonschema {by_jsonschema}, regress {by_regress}"
                ));
            }
        }
    }

    assert!(divergences.is_empty(), "{}", divergences.join("\n"));

    Ok(())
}
