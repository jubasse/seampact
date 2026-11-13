//! The resolved conventions, their schema leaves and the default table against ADR 0002.

use seampact_authoring::ApiLayer;
use seampact_json::JsonValue;
use seampact_pipeline::{
    ConventionDefaultValue, ConventionReading, convention_defaults, convention_schema_leaves,
    derivation_roles, pipeline_conventions, pipeline_rate_limit_param,
};

use super::raw_api::{api_origin, raw_api};
use crate::support::repository_root;

fn json(text: &str) -> JsonValue {
    serde_json::from_str(text).unwrap()
}

fn two_layers() -> seampact_authoring::RawApi {
    raw_api(&[
        (
            ApiLayer::Shared,
            r#"{"conventions":{"bodyLimit":"2MiB","paging":{"maxLimit":100,"default":"cursor"}}}"#,
        ),
        (
            ApiLayer::Api,
            r#"{"conventions":{"paging":{"maxLimit":50},"errors":{"derived":{"forbidden":"a.denied"}}}}"#,
        ),
    ])
}

#[test]
fn written_values_come_with_their_origins_else_the_core_defaults() {
    let raw = two_layers();
    let conventions = pipeline_conventions(&raw);
    let max_limit = conventions.get("paging.maxLimit").unwrap().unwrap();

    // The api's leaf wins over the shared file's, and keeps the shared file's other leaves.
    assert_eq!(max_limit.value, &json("50"));
    assert_eq!(
        max_limit.origin,
        Some(api_origin("/conventions/paging/maxLimit"))
    );
    assert_eq!(
        conventions
            .get("paging.default")
            .unwrap()
            .unwrap()
            .origin
            .unwrap()
            .layer,
        seampact_ir::Layer::Shared
    );

    // A core default has no origin; a default that is another key's value carries that key's.
    assert_eq!(
        conventions.get("format").unwrap(),
        Some(ConventionReading {
            value: &json("\"bare\""),
            origin: None
        })
    );
    assert_eq!(
        conventions.get("paging.defaultLimit").unwrap(),
        conventions.get("paging.maxLimit").unwrap()
    );

    let batch = conventions.get("batch.bodyLimit").unwrap().unwrap();

    assert_eq!(batch.value, &json("\"2MiB\""));
    assert_eq!(batch.origin.unwrap().layer, seampact_ir::Layer::Shared);
}

#[test]
fn role_bindings_are_written_or_the_roles_default_code() {
    let raw = two_layers();
    let conventions = pipeline_conventions(&raw);
    let role = derivation_roles()
        .iter()
        .find(|role| role.role.as_str() == "notFound")
        .unwrap();

    assert_eq!(
        conventions
            .get("errors.derived.forbidden")
            .unwrap()
            .unwrap()
            .value,
        &json("\"a.denied\"")
    );
    assert_eq!(
        conventions.get("errors.derived.notFound").unwrap(),
        Some(ConventionReading {
            value: &JsonValue::String(role.default_code.to_owned()),
            origin: None
        })
    );
}

#[test]
fn an_unset_key_has_no_default_and_idempotency_defaults_need_idempotency() {
    let raw = two_layers();
    let conventions = pipeline_conventions(&raw);

    assert_eq!(conventions.get("idempotency.methods").unwrap(), None);
    assert_eq!(conventions.get("rateLimit.header").unwrap(), None);
    assert_eq!(conventions.get("cache.families.minute").unwrap(), None);
    assert_eq!(
        pipeline_conventions(&raw_api(&[(ApiLayer::Api, "{}")]))
            .get("errors.derived")
            .unwrap(),
        None
    );

    let idempotent = raw_api(&[(
        ApiLayer::Api,
        r#"{"conventions":{"idempotency":{"header":"Idempotency-Key"}}}"#,
    )]);

    assert_eq!(
        pipeline_conventions(&idempotent)
            .get("idempotency.methods")
            .unwrap()
            .unwrap()
            .value,
        &json(r#"["post","put","patch","delete"]"#)
    );
}

#[test]
fn only_a_leaf_or_an_entry_of_a_map_leaf_is_read() {
    let raw = raw_api(&[(ApiLayer::Api, "{}")]);
    let conventions = pipeline_conventions(&raw);

    // A typo, an object, an entry below a value leaf, a key a map leaf refuses, `$include`,
    // nothing at all.
    for path in [
        "bodylimit",
        "nothing.here",
        "idempotency",
        "ops.list",
        "format.name",
        "errors.derived.nope",
        "cache.families.Minute",
        "cache.families.$include",
        "",
    ] {
        let failure = conventions.get(path).unwrap_err();

        assert!(
            failure
                .what()
                .contains("is no leaf of the conventions schema"),
            "{path}: {}",
            failure.what()
        );
    }

    assert_eq!(
        conventions.get("cache.families").unwrap().unwrap().value,
        &json("{}")
    );
    assert_eq!(
        conventions.get("ops.batch.path").unwrap().unwrap().value,
        &json("\"batch\"")
    );
}

#[test]
fn the_rate_limit_param_is_the_written_string_only() {
    let named = raw_api(&[(
        ApiLayer::Api,
        r#"{"conventions":{"rateLimit":{"param":"retryAfter"}}}"#,
    )]);
    let none = raw_api(&[(ApiLayer::Api, "{}")]);
    let not_text = raw_api(&[(
        ApiLayer::Api,
        r#"{"conventions":{"rateLimit":{"param":3}}}"#,
    )]);

    assert_eq!(
        pipeline_rate_limit_param(pipeline_conventions(&named)).unwrap(),
        Some("retryAfter")
    );
    assert_eq!(
        pipeline_rate_limit_param(pipeline_conventions(&none)).unwrap(),
        None
    );
    assert_eq!(
        pipeline_rate_limit_param(pipeline_conventions(&not_text)).unwrap(),
        None
    );
}

#[test]
fn the_schema_leaves_are_the_default_paths_parents_and_the_two_maps() {
    let leaves = convention_schema_leaves().unwrap();
    let maps: Vec<&str> = leaves
        .iter()
        .filter(|(_, entries)| entries.is_some())
        .map(|(path, _)| path.as_str())
        .collect();

    assert_eq!(maps, ["cache.families", "errors.derived"]);

    let derived = leaves.get("errors.derived").unwrap().as_ref().unwrap();

    for role in derivation_roles() {
        assert!(derived.find(role.role.as_str()).is_some(), "{}", role.role);
    }

    // Every ops leaf the defaults write is a leaf of the schema.
    for op in ["list", "get", "create", "update", "delete", "batch"] {
        for field in ["method", "path", "status"] {
            assert!(
                leaves.contains_key(&format!("ops.{op}.{field}")),
                "ops.{op}.{field}"
            );
        }
    }
}

#[test]
fn every_default_path_is_a_readable_convention_path() {
    let raw = raw_api(&[(ApiLayer::Api, "{}")]);
    let conventions = pipeline_conventions(&raw);

    for entry in convention_defaults().unwrap() {
        conventions
            .get(&entry.path)
            .unwrap_or_else(|failure| panic!("{}: {}", entry.path, failure.what()));
    }
}

// The rows of the first table under `heading` whose header starts with `header`, as unescaped
// cells.
fn adr_table(file: &str, heading: &str, header: &str) -> Vec<Vec<String>> {
    let source = std::fs::read_to_string(repository_root().join(file)).unwrap();
    let section = source.get(source.find(heading).unwrap()..).unwrap();
    let lines: Vec<&str> = section.lines().collect();
    let start = lines
        .iter()
        .position(|line| line.starts_with(header))
        .unwrap();

    lines
        .iter()
        .skip(start + 2)
        .take_while(|line| line.starts_with('|'))
        .map(|line| {
            let inner = line.trim_start_matches('|').trim_end_matches('|');

            inner
                .replace("\\|", "\u{0}")
                .split('|')
                .map(|cell| cell.trim().replace('\u{0}', "|"))
                .collect()
        })
        .collect()
}

// Whether `value` stands in `text` as a word: no letter, digit or dash on either side.
fn has_word(text: &str, value: &str) -> bool {
    let is_word_char = |c: char| c.is_ascii_alphanumeric() || c == '-';

    text.match_indices(value).any(|(at, found)| {
        let before = text.get(..at).and_then(|head| head.chars().next_back());
        let after = text
            .get(at + found.len()..)
            .and_then(|tail| tail.chars().next());

        !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
    })
}

struct ConventionRow {
    key: String,
    meaning: String,
    fallback: String,
}

fn convention_rows() -> Vec<ConventionRow> {
    adr_table(
        "docs/grammar/13-conventions-and-wire-formats.md",
        "### 13. Conventions and wire formats",
        "| Key | Meaning |",
    )
    .into_iter()
    .map(|cells| ConventionRow {
        key: cells[0].replace('`', ""),
        meaning: cells[1].clone(),
        fallback: cells[2].clone(),
    })
    .collect()
}

fn text_of(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => text.clone(),
        JsonValue::Bool(flag) => flag.to_string(),
        other => format!("{other:?}"),
    }
}

fn check_ops_default(path: &str, value: &JsonValue, ops: &[Vec<String>]) {
    let mut parts = path.split('.').skip(1);
    let (op, field) = (parts.next().unwrap(), parts.next().unwrap());
    let row = ops
        .iter()
        .find(|cells| cells[0] == format!("`{op}`"))
        .unwrap();
    let (route, success) = (&row[2], &row[5]);
    let text = text_of(value);

    match field {
        "method" => assert!(
            route.contains(&format!("{} /", text.to_uppercase())),
            "{path}"
        ),
        "path" => {
            let first = route.split(',').next().unwrap();

            if text.is_empty() {
                assert!(
                    first.ends_with("/tasks`") || first.ends_with("/tasks/{taskId}`"),
                    "{path}: {first}"
                );
            } else {
                assert!(first.ends_with("/batch`"), "{path}: {first}");
            }
        }
        _ => {
            let JsonValue::Number(status) = value else {
                panic!("{path}: a status is a number");
            };
            let digits = status.to_f64().to_string();

            assert!(
                success.starts_with(&format!("`{digits}")),
                "{path}: {success}"
            );
        }
    }
}

#[test]
fn every_convention_default_traces_to_the_adr_0002_section_13_table() {
    let table = convention_rows();
    let ops = adr_table(
        "docs/grammar/06-surfaces-and-the-tree.md",
        "#### The `ops` shorthand",
        "| Op | On |",
    );

    assert!(table.len() > 20);

    for entry in convention_defaults().unwrap() {
        let row = table
            .iter()
            .filter(|row| entry.path == row.key || entry.path.starts_with(&format!("{}.", row.key)))
            .max_by_key(|row| row.key.len())
            .unwrap_or_else(|| panic!("{}: no row", entry.path));

        let ConventionDefaultValue::Value { value, within } = &entry.value else {
            let ConventionDefaultValue::From(other) = &entry.value else {
                continue;
            };
            let last = other.rsplit('.').next().unwrap();

            assert!(
                row.fallback.contains(&format!("`{last}`")),
                "{}",
                entry.path
            );
            continue;
        };

        // The default column states the default; the `idempotency.*` ones, under an unset key, are
        // in its meaning.
        let text = if within.is_none() {
            &row.fallback
        } else {
            &row.meaning
        };
        let member = entry.path.get(row.key.len() + 1..).unwrap_or_default();

        if within.is_some() {
            assert!(row.fallback.starts_with("unset"), "{}", entry.path);
        }

        // A default stated in prose names its member: "`enforce` is `boundary`".
        if text.contains(&format!("`{member}` is `")) {
            assert!(
                text.contains(&format!("`{member}` is `{}`", text_of(value))),
                "{}",
                entry.path
            );
        }

        if entry.path.starts_with("ops.") {
            check_ops_default(&entry.path, value, &ops);
        } else if entry.path.starts_with("errors.derived.") {
            assert!(
                row.fallback.contains("ADR 0006 section 6"),
                "{}",
                entry.path
            );
        } else if let JsonValue::String(word) = value {
            // An object default written as `{ member: value, ... }` names the member beside its value.
            if !member.is_empty() && text.contains(&format!("{member}:")) {
                assert!(
                    text.contains(&format!("{member}: {word}")),
                    "{}",
                    entry.path
                );
            } else {
                assert!(has_word(text, word), "{}: {word}", entry.path);
            }
        } else if let JsonValue::Bool(flag) = value {
            assert!(text.contains(&format!("`{flag}`")), "{}", entry.path);
        } else if let JsonValue::Array(items) = value
            && !items.is_empty()
        {
            for item in items {
                assert!(has_word(text, &text_of(item)), "{}: {item:?}", entry.path);
            }
        } else {
            // An empty list or map.
            assert!(row.fallback.starts_with("empty"), "{}", entry.path);
        }
    }

    // Every row that states a default has one in the table, under its key.
    for row in table
        .iter()
        .filter(|row| !row.fallback.starts_with("none") && !row.fallback.starts_with("unset"))
    {
        assert!(
            convention_defaults().unwrap().iter().any(|entry| {
                entry.path == row.key || entry.path.starts_with(&format!("{}.", row.key))
            }),
            "{}",
            row.key
        );
    }
}
