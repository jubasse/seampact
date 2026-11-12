//! The hand-written draft fixtures of the reference contract, and the complete expected IRs, held
//! to the typed draft.

use std::collections::BTreeSet;

use seampact_json::JsonValue;
use seampact_pipeline::{DraftIr, Half, draft_delta};

use crate::support::{
    DraftFixtureFile, FIXTURE_APIS, draft_fixture, draft_fixture_halves, draft_fixture_json,
    files_under, read_json, repository_root,
};

const AFTER_TREE: [DraftFixtureFile; 1] = [DraftFixtureFile::AfterTree];
const AFTER_ACCESS: [DraftFixtureFile; 2] =
    [DraftFixtureFile::AfterTree, DraftFixtureFile::AccessDelta];

/// The members finalize writes at the top level.
const FINALIZE_MEMBERS: [&str; 4] = ["irVersion", "irRevision", "kinds", "features"];

fn member<'value>(value: &'value JsonValue, key: &str) -> Option<&'value JsonValue> {
    match value {
        JsonValue::Object(object) => object.get(key),
        _ => None,
    }
}

fn path<'value>(value: &'value JsonValue, keys: &[&str]) -> Option<&'value JsonValue> {
    keys.iter()
        .try_fold(value, |current, key| member(current, key))
}

fn items(value: Option<&JsonValue>) -> &[JsonValue] {
    match value {
        Some(JsonValue::Array(items)) => items,
        _ => &[],
    }
}

fn text(value: Option<&JsonValue>) -> Option<&str> {
    match value {
        Some(JsonValue::String(text)) => Some(text),
        _ => None,
    }
}

fn operations(draft: &JsonValue) -> &[JsonValue] {
    items(member(draft, "operations"))
}

fn properties_of<'draft>(draft: &'draft JsonValue, schema_id: &str) -> &'draft [JsonValue] {
    let Some(schema) = path(draft, &["schemas", schema_id]) else {
        return &[];
    };

    if text(member(schema, "kind")) != Some("object") {
        return &[];
    }

    items(member(schema, "properties"))
}

fn property_named<'draft>(
    draft: &'draft JsonValue,
    schema_id: &str,
    name: &str,
) -> Option<&'draft JsonValue> {
    properties_of(draft, schema_id)
        .iter()
        .find(|property| text(member(property, "name")) == Some(name))
}

// The restriction a property carries, following array items and references along the pointer.
fn restriction_of<'draft>(
    draft: &'draft JsonValue,
    schema_id: &str,
    pointer: &str,
) -> Option<&'draft JsonValue> {
    let mut segments = pointer.split('/');
    let property = property_named(draft, schema_id, segments.next()?)?;
    let mut rest: Vec<&str> = segments.collect();

    if rest.is_empty() {
        return member(property, "restrictedTo");
    }

    let mut property_type = member(property, "type")?;

    while text(member(property_type, "kind")) == Some("array") && rest.first() == Some(&"*") {
        property_type = member(property_type, "items")?;
        rest.remove(0);
    }

    if text(member(property_type, "kind")) != Some("ref") {
        return None;
    }

    restriction_of(
        draft,
        text(member(property_type, "schema"))?,
        &rest.join("/"),
    )
}

fn first_ref_body(operation: &JsonValue) -> Option<&JsonValue> {
    items(member(operation, "responses"))
        .iter()
        .filter_map(|response| member(response, "body"))
        .find(|body| text(member(body, "kind")) == Some("ref"))
}

fn first_origin(derived_from: Option<&JsonValue>) -> Option<&JsonValue> {
    items(derived_from.and_then(|value| member(value, "from"))).first()
}

#[test]
fn each_fixture_decodes_into_the_draft_and_writes_back() -> Result<(), String> {
    for api in FIXTURE_APIS {
        for files in [&AFTER_TREE[..], &AFTER_ACCESS[..]] {
            let json = draft_fixture_json(api, files)?;
            let decoded = DraftIr::from_json_value(&json).map_err(|failure| failure.to_string())?;
            let written_back = decoded
                .to_json_value()
                .map_err(|failure| failure.to_string())?;

            assert_eq!(written_back, json, "{api} after {} file(s)", files.len());
        }
    }

    Ok(())
}

#[test]
fn tree_writes_the_after_tree_file_and_access_the_delta() -> Result<(), String> {
    for api in FIXTURE_APIS {
        let tree: Vec<Half> = draft_fixture_halves(api, DraftFixtureFile::AfterTree)?
            .into_iter()
            .map(|(half, _)| half)
            .collect();
        let access: Vec<Half> = draft_fixture_halves(api, DraftFixtureFile::AccessDelta)?
            .into_iter()
            .map(|(half, _)| half)
            .collect();

        assert_eq!(tree, [Half::TreeSchemas, Half::TreeNodes], "{api}");
        assert_eq!(access, [Half::AccessIdentity, Half::AccessRights], "{api}");
    }

    Ok(())
}

#[test]
fn a_complete_draft_with_finalizes_members_is_an_ir() -> Result<(), String> {
    let directory = repository_root().join("fixtures/expected/reference/ir");
    let files = files_under(&directory, &|path| {
        path.extension()
            .is_some_and(|extension| extension == "json")
    })
    .map_err(|failure| failure.to_string())?;

    assert!(
        !files.is_empty(),
        "no expected IR under {}",
        directory.display()
    );

    for file in files {
        let JsonValue::Object(mut complete) = read_json(&file)? else {
            return Err(format!("{}: an IR is an object", file.display()));
        };

        for finalize_member in FINALIZE_MEMBERS {
            complete.remove(finalize_member);
        }

        if let Some(JsonValue::Array(operations)) = complete.get_mut("operations") {
            for operation in operations {
                if let JsonValue::Object(operation) = operation {
                    operation.remove("features");
                }
            }
        }

        let draft = JsonValue::Object(complete);
        let decoded = DraftIr::from_json_value(&draft).map_err(|failure| failure.to_string())?;

        assert_eq!(
            decoded
                .to_json_value()
                .map_err(|failure| failure.to_string())?,
            draft,
            "{}",
            file.display()
        );
    }

    Ok(())
}

#[test]
fn tasks_access_rights_writes_a_proof_only_input_where_tree_left_none() -> Result<(), String> {
    let after_tree = draft_fixture_json("tasks", &AFTER_TREE)?;
    let after_access = draft_fixture_json("tasks", &AFTER_ACCESS)?;
    let without_input: Vec<&str> = operations(&after_tree)
        .iter()
        .filter(|operation| member(operation, "input").is_none())
        .filter_map(|operation| text(member(operation, "id")))
        .collect();
    let proof_only: Vec<&JsonValue> = operations(&after_access)
        .iter()
        .filter(|operation| {
            text(member(operation, "id")).is_some_and(|id| without_input.contains(&id))
                && path(operation, &["input", "proofs"]).is_some()
        })
        .collect();
    let ids: Vec<Option<&str>> = proof_only
        .iter()
        .map(|operation| text(member(operation, "id")))
        .collect();

    assert_eq!(ids, [Some("purgeTask")]);

    let delta = draft_delta(&after_tree, &after_access).map_err(|failure| failure.to_string())?;
    let delta = JsonValue::Object(delta);

    for operation in proof_only {
        let input = member(operation, "input").ok_or("a proof-only operation has an input")?;
        let id = text(member(operation, "id")).unwrap_or_default();

        assert_eq!(
            text(member(input, "media")),
            Some("application/json"),
            "{id}"
        );
        assert_eq!(
            text(path(input, &["schema", "schema"])),
            Some("ApiEmptyBody"),
            "{id}"
        );
        assert_eq!(
            member(input, "rawBody"),
            Some(&JsonValue::Bool(false)),
            "{id}"
        );
        assert_eq!(
            member(input, "origin"),
            first_origin(
                path(input, &["proofs"])
                    .and_then(|proofs| items(Some(proofs)).first())
                    .and_then(|proof| member(proof, "derivedFrom"))
            ),
            "{id}"
        );
        assert!(
            path(&delta, &["operations", id, "input", "media"]).is_some(),
            "the delta from tree to access holds the whole proof-only input of {id}"
        );
    }

    Ok(())
}

#[test]
fn tasks_restricted_fields_and_sort_keys_derive_from_their_propertys_restriction()
-> Result<(), String> {
    let draft = draft_fixture_json("tasks", &AFTER_ACCESS)?;
    let mut checked: Vec<String> = Vec::new();

    for operation in operations(&draft) {
        let id = text(member(operation, "id")).unwrap_or_default();

        for field_right in items(member(operation, "fieldRights")) {
            let schema = text(member(field_right, "schema")).unwrap_or_default();
            let pointer = text(member(field_right, "pointer")).unwrap_or_default();
            let restriction = restriction_of(&draft, schema, pointer.get(1..).unwrap_or_default());

            assert_eq!(
                first_origin(member(field_right, "derivedFrom")),
                restriction.and_then(|found| member(found, "origin")),
                "{id}"
            );
            checked.push(format!("{id} {schema}{pointer}"));
        }

        let Some(item) = first_ref_body(operation) else {
            continue;
        };

        for sort_key in items(path(operation, &["paging", "sortKeys"])) {
            let Some(derived_from) = member(sort_key, "derivedFrom") else {
                continue;
            };
            let key = text(member(sort_key, "key")).unwrap_or_default();
            let restriction = restriction_of(
                &draft,
                text(member(item, "schema")).unwrap_or_default(),
                key,
            );

            assert_eq!(
                first_origin(Some(derived_from)),
                restriction.and_then(|found| member(found, "origin")),
                "{id}"
            );
            checked.push(format!("{id} sort {key}"));
        }
    }

    assert!(
        checked.contains(&"createTask CreateTask/effort".to_owned()),
        "{checked:?}"
    );

    Ok(())
}

#[test]
fn tasks_version_property_is_the_last_of_each_body_versioned_input_and_only_there()
-> Result<(), String> {
    let draft = draft_fixture_json("tasks", &AFTER_TREE)?;
    let mut versioned_inputs: BTreeSet<String> = BTreeSet::new();

    for operation in operations(&draft) {
        let id = text(member(operation, "id")).unwrap_or_default();
        let version = path(operation, &["concurrency", "version"]);
        let input = path(operation, &["input", "schema"]);
        let item = first_ref_body(operation);

        let (Some(version), Some(input), Some(item)) = (version, input, item) else {
            continue;
        };

        if text(member(version, "in")) != Some("body") || text(member(input, "kind")) != Some("ref")
        {
            continue;
        }

        let input_schema = text(member(input, "schema")).unwrap_or_default();
        let version_property = properties_of(&draft, input_schema).last();
        let item_field = property_named(
            &draft,
            text(member(item, "schema")).unwrap_or_default(),
            text(path(operation, &["concurrency", "field"])).unwrap_or_default(),
        );

        versioned_inputs.insert(input_schema.to_owned());
        assert_eq!(
            version_property.and_then(|property| text(member(property, "name"))),
            text(member(version, "name")),
            "{id}"
        );
        assert_eq!(
            version_property.and_then(|property| member(property, "type")),
            item_field.and_then(|field| member(field, "type")),
            "{id}"
        );
        assert_eq!(
            text(
                version_property
                    .and_then(|property| path(property, &["derivedFrom", "derivation"]))
            ),
            Some("concurrency.version"),
            "{id}"
        );
    }

    let schemas_with_version_property: BTreeSet<String> = match member(&draft, "schemas") {
        Some(JsonValue::Object(schemas)) => schemas
            .keys()
            .filter(|schema_id| {
                properties_of(&draft, schema_id).iter().any(|property| {
                    text(path(property, &["derivedFrom", "derivation"]))
                        == Some("concurrency.version")
                })
            })
            .cloned()
            .collect(),
        _ => BTreeSet::new(),
    };

    assert_eq!(schemas_with_version_property, versioned_inputs);
    assert!(!versioned_inputs.is_empty());

    Ok(())
}
