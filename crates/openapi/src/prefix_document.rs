//! An api's prefix in a merged document: `<prefix>.` before each of its operation ids and
//! component keys, with every reference to a component following the new key.

use std::collections::HashSet;

use seampact_json::{JsonObject, JsonValue};

use crate::ExtensionName;
use crate::emit_context::{COMPONENT_SCHEMA_PREFIX, EXTENSION_PREFIX};

/// The item member of the `restricted-to` extension that names a schema component key.
const RESTRICTED_TO_KEY_MEMBER: &str = "schema";

/// The schema keys of a document and the prefix they take.
struct SchemaRenaming {
    prefix: String,
    schema_keys: HashSet<String>,
}

/// Whether a prefix is made of the characters of an OpenAPI component key.
pub(crate) fn is_valid_prefix(prefix: &str) -> bool {
    !prefix.is_empty()
        && prefix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

/// A copy of the document with `prefix` applied; the document itself is left as it is.
pub(crate) fn prefix_document(document: &JsonObject, prefix: &str) -> JsonObject {
    let components = document.object_member("components");
    let renaming = SchemaRenaming {
        prefix: prefix.to_owned(),
        schema_keys: keys_of_member(components, "schemas"),
    };
    let scheme_keys = keys_of_member(components, "securitySchemes");
    let mut prefixed = with_schema_references_in_object(document, &renaming);

    if let Some(JsonValue::Object(prefixed_components_source)) = prefixed.get("components") {
        let renamed = prefixed_components(prefixed_components_source, prefix);

        prefixed.insert("components".to_owned(), JsonValue::Object(renamed));
    }

    prefix_operations(&mut prefixed, prefix, &scheme_keys);

    prefixed
}

fn keys_of_member(object: Option<&JsonObject>, member: &str) -> HashSet<String> {
    object
        .and_then(|found| found.object_member(member))
        .map(|members| members.keys().cloned().collect())
        .unwrap_or_default()
}

fn prefix_operations(document: &mut JsonObject, prefix: &str, scheme_keys: &HashSet<String>) {
    let Some(JsonValue::Object(paths)) = document.get_mut("paths") else {
        return;
    };
    let path_names: Vec<String> = paths.keys().cloned().collect();

    for path_name in path_names {
        let Some(JsonValue::Object(path_item)) = paths.get_mut(&path_name) else {
            continue;
        };
        let method_names: Vec<String> = path_item.keys().cloned().collect();

        for method_name in method_names {
            if let Some(JsonValue::Object(operation)) = path_item.get_mut(&method_name) {
                prefix_operation(operation, prefix, scheme_keys);
            }
        }
    }
}

fn prefix_operation(operation: &mut JsonObject, prefix: &str, scheme_keys: &HashSet<String>) {
    if let Some(JsonValue::String(operation_id)) = operation.get("operationId") {
        let prefixed_id = format!("{prefix}.{operation_id}");

        operation.insert("operationId".to_owned(), JsonValue::String(prefixed_id));
    }

    let Some(JsonValue::Array(requirements)) = operation.get("security") else {
        return;
    };
    let renamed: Vec<JsonValue> = requirements
        .iter()
        .map(|requirement| prefixed_requirement(requirement, prefix, scheme_keys))
        .collect();

    operation.insert("security".to_owned(), JsonValue::Array(renamed));
}

fn prefixed_requirement(
    requirement: &JsonValue,
    prefix: &str,
    scheme_keys: &HashSet<String>,
) -> JsonValue {
    let JsonValue::Object(schemes) = requirement else {
        return requirement.clone();
    };
    let mut renamed = JsonObject::new();

    for (scheme, scopes) in schemes {
        let key = if scheme_keys.contains(scheme) {
            format!("{prefix}.{scheme}")
        } else {
            scheme.clone()
        };

        renamed.insert(key, scopes.clone());
    }

    JsonValue::Object(renamed)
}

fn prefixed_components(components: &JsonObject, prefix: &str) -> JsonObject {
    let mut prefixed = JsonObject::new();

    for (section, entries) in components {
        let written = match entries {
            JsonValue::Object(keyed) => JsonValue::Object(prefixed_keys(keyed, prefix)),
            other => other.clone(),
        };

        prefixed.insert(section.clone(), written);
    }

    prefixed
}

fn prefixed_keys(entries: &JsonObject, prefix: &str) -> JsonObject {
    let mut prefixed = JsonObject::new();

    for (key, value) in entries {
        prefixed.insert(format!("{prefix}.{key}"), value.clone());
    }

    prefixed
}

fn prefixed_schema_key(key: &str, renaming: &SchemaRenaming) -> String {
    if renaming.schema_keys.contains(key) {
        return format!("{}.{key}", renaming.prefix);
    }

    key.to_owned()
}

fn prefixed_reference(reference: &str, renaming: &SchemaRenaming) -> String {
    let Some(key) = reference.strip_prefix(COMPONENT_SCHEMA_PREFIX) else {
        return reference.to_owned();
    };

    format!(
        "{COMPONENT_SCHEMA_PREFIX}{}",
        prefixed_schema_key(key, renaming)
    )
}

/// A copy where each `$ref`, discriminator mapping and extension member naming a schema of the
/// document names the prefixed key; any other string, such as an example, is data and stays.
fn with_schema_references(value: &JsonValue, renaming: &SchemaRenaming) -> JsonValue {
    match value {
        JsonValue::Array(items) => JsonValue::Array(
            items
                .iter()
                .map(|item| with_schema_references(item, renaming))
                .collect(),
        ),
        JsonValue::Object(object) => {
            JsonValue::Object(with_schema_references_in_object(object, renaming))
        }
        other => other.clone(),
    }
}

fn with_schema_references_in_object(object: &JsonObject, renaming: &SchemaRenaming) -> JsonObject {
    let mut copy = JsonObject::new();

    for (member, member_value) in object {
        copy.insert(
            member.clone(),
            renamed_member(member, member_value, renaming),
        );
    }

    if let Some(JsonValue::Object(discriminator)) = copy.get("discriminator") {
        let branches = match object.get("oneOf") {
            Some(JsonValue::Array(items)) => items.as_slice(),
            _ => &[],
        };
        let renamed = prefixed_discriminator(discriminator, branches, renaming);

        copy.insert("discriminator".to_owned(), JsonValue::Object(renamed));
    }

    copy
}

fn renamed_member(member: &str, value: &JsonValue, renaming: &SchemaRenaming) -> JsonValue {
    if member == "$ref"
        && let JsonValue::String(reference) = value
    {
        return JsonValue::String(prefixed_reference(reference, renaming));
    }

    if is_restricted_to_member(member)
        && let JsonValue::Array(items) = value
    {
        return JsonValue::Array(
            items
                .iter()
                .map(|item| with_prefixed_key_member(item, RESTRICTED_TO_KEY_MEMBER, renaming))
                .collect(),
        );
    }

    with_schema_references(value, renaming)
}

fn is_restricted_to_member(member: &str) -> bool {
    member.strip_prefix(EXTENSION_PREFIX) == Some(ExtensionName::RestrictedTo.as_str())
}

fn with_prefixed_key_member(
    item: &JsonValue,
    key_member: &str,
    renaming: &SchemaRenaming,
) -> JsonValue {
    let mut copy = with_schema_references(item, renaming);

    if let JsonValue::Object(object) = &mut copy
        && let Some(JsonValue::String(key)) = object.get(key_member)
    {
        let prefixed_key = prefixed_schema_key(key, renaming);

        object.insert(key_member.to_owned(), JsonValue::String(prefixed_key));
    }

    copy
}

/// The discriminator with its mapping on the prefixed keys; a missing mapping is written from the
/// `oneOf` branches that reference a schema.
fn prefixed_discriminator(
    discriminator: &JsonObject,
    branches: &[JsonValue],
    renaming: &SchemaRenaming,
) -> JsonObject {
    if discriminator.get("mapping").is_some() {
        let mut renamed = JsonObject::new();

        for (value, reference) in discriminator.object_member("mapping").into_iter().flatten() {
            let written = match reference {
                JsonValue::String(text) => JsonValue::String(prefixed_reference(text, renaming)),
                other => other.clone(),
            };

            renamed.insert(value.clone(), written);
        }

        return with_mapping(discriminator, renamed);
    }

    let mut mapping = JsonObject::new();

    for branch in branches {
        let JsonValue::Object(branch_object) = branch else {
            continue;
        };
        let Some(JsonValue::String(reference)) = branch_object.get("$ref") else {
            continue;
        };
        let Some(key) = reference.strip_prefix(COMPONENT_SCHEMA_PREFIX) else {
            continue;
        };

        mapping.insert(
            key.to_owned(),
            JsonValue::String(prefixed_reference(reference, renaming)),
        );
    }

    if mapping.is_empty() {
        return discriminator.clone();
    }

    with_mapping(discriminator, mapping)
}

fn with_mapping(discriminator: &JsonObject, mapping: JsonObject) -> JsonObject {
    let mut written = discriminator.clone();

    written.insert("mapping".to_owned(), JsonValue::Object(mapping));

    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json_value::object_from_text;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn references_and_keys_are_renamed_and_a_data_string_naming_a_component_stays() -> TestResult {
        let document = object_from_text(
            r##"{"openapi": "3.1.0", "paths": {}, "components": {"schemas": {
                "Task": {"type": "string", "examples": ["#/components/schemas/Task"], "default": "#/components/schemas/Task"},
                "Holder": {"$ref": "#/components/schemas/Task", "description": "#/components/schemas/Task"}}}}"##,
        )?;
        let expected = object_from_text(
            r##"{"openapi": "3.1.0", "paths": {}, "components": {"schemas": {
                "p.Task": {"type": "string", "examples": ["#/components/schemas/Task"], "default": "#/components/schemas/Task"},
                "p.Holder": {"$ref": "#/components/schemas/p.Task", "description": "#/components/schemas/Task"}}}}"##,
        )?;

        assert_eq!(prefix_document(&document, "p"), expected);

        Ok(())
    }

    #[test]
    fn operation_ids_and_the_schemes_of_security_requirements_take_the_prefix() -> TestResult {
        let document = object_from_text(
            r#"{"paths": {"/a": {"get": {"operationId": "list", "security": [{"bearer": [], "other": ["x"]}, {}]}, "parameters": []}},
                "components": {"securitySchemes": {"bearer": {"type": "http"}}}}"#,
        )?;
        let expected = object_from_text(
            r#"{"paths": {"/a": {"get": {"operationId": "p.list", "security": [{"p.bearer": [], "other": ["x"]}, {}]}, "parameters": []}},
                "components": {"securitySchemes": {"p.bearer": {"type": "http"}}}}"#,
        )?;

        assert_eq!(prefix_document(&document, "p"), expected);

        Ok(())
    }

    #[test]
    fn a_discriminator_without_a_mapping_is_written_from_its_branches() -> TestResult {
        let document = object_from_text(
            r##"{"components": {"schemas": {"A": {}, "Pet": {"oneOf": [{"$ref": "#/components/schemas/A"}, {"type": "string"}], "discriminator": {"propertyName": "kind"}}}}}"##,
        )?;
        let expected = object_from_text(
            r##"{"components": {"schemas": {"p.A": {}, "p.Pet": {"oneOf": [{"$ref": "#/components/schemas/p.A"}, {"type": "string"}], "discriminator": {"propertyName": "kind", "mapping": {"A": "#/components/schemas/p.A"}}}}}}"##,
        )?;

        assert_eq!(prefix_document(&document, "p"), expected);

        Ok(())
    }

    #[test]
    fn a_restricted_to_item_names_its_schema_under_the_prefix() -> TestResult {
        let document = object_from_text(
            r#"{"components": {"schemas": {"Role": {}, "T": {"x-seampact-restricted-to": [{"schema": "Role"}, {"schema": "Gone"}]}}}}"#,
        )?;
        let expected = object_from_text(
            r#"{"components": {"schemas": {"p.Role": {}, "p.T": {"x-seampact-restricted-to": [{"schema": "p.Role"}, {"schema": "Gone"}]}}}}"#,
        )?;

        assert_eq!(prefix_document(&document, "p"), expected);

        Ok(())
    }

    #[test]
    fn a_prefix_is_ascii_letters_digits_dot_dash_and_underscore_only() {
        for valid in ["billing", "a.b-c_d", "0", "A"] {
            assert!(is_valid_prefix(valid), "prefix {valid:?}");
        }

        // The ECMAScript `$` does not match before a final newline, and `[A-Za-z]` is ASCII.
        for invalid in ["", "a\n", "caf\u{e9}", "a b", "a/b", "\u{ff21}"] {
            assert!(!is_valid_prefix(invalid), "prefix {invalid:?}");
        }
    }
}
