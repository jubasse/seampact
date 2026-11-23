//! The rules of an error code: its role bindings, its retry header and its no-store.

use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, object_of, text_of};

use super::json_members::{entry, js_number_of};
use super::violation::{IrInvariantId, Violations};
use crate::instance_walk::{IrInstanceNode, walk_ir_instance};
use crate::{
    IrError, IrMap, Schema, SchemaId, derivation_ids,
    find_ir_sensitive_param_reaches_skipping_missing, sensitive_reach_text,
};

/// The status of the code a retry header sits on.
const RETRY_STATUS: f64 = 429.0;

/// The largest integer a retry delay may be, 2^53 - 1.
const SAFE_MAXIMUM: f64 = 9_007_199_254_740_991.0;

/// The template definition the `each` search starts from.
const TEMPLATE_REFERENCE: &str = "#/$defs/Template";

/// The role bindings an error's `roles` member holds.
pub(super) fn bindings_in(roles: Option<&JsonValue>) -> Vec<&JsonObject> {
    items_of(roles)
        .iter()
        .filter_map(|binding| object_of(Some(binding)))
        .collect()
}

// The pointers of the `each` templates of `template`, relative to it.
fn each_pointers(template: Option<&JsonValue>) -> Result<Vec<String>, IrError> {
    let Some(template) = template else {
        return Ok(Vec::new());
    };
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(TEMPLATE_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut found = Vec::new();

    walk_ir_instance(template, &schema, "", &mut |node| {
        if let IrInstanceNode::Union {
            pointer,
            tag,
            value,
            ..
        } = node
            && *tag == "kind"
            && is_text(value.get("kind"), "each")
        {
            found.push((*pointer).to_owned());
        }

        Ok(())
    })?;

    Ok(found)
}

fn declaration_of<'errors>(
    errors: &'errors JsonObject,
    code: Option<&JsonValue>,
) -> Option<&'errors JsonObject> {
    object_of(entry(errors, code))
}

/// A role binding has `params` if and only if its code declares params, and no `each` of its
/// params sits inside another.
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when the embedded schemas do not read as the walk expects.
pub(super) fn check_role_params(
    value: &JsonObject,
    pointer: &str,
    errors: &JsonObject,
    out: &mut Violations,
) -> Result<(), IrError> {
    let declaration = declaration_of(errors, value.get("code"));

    for (index, binding) in bindings_in(value.get("roles")).iter().enumerate() {
        let at = format!("{pointer}/roles/{index}");

        if let Some(declaration) = declaration
            && declaration.contains_key("params") != binding.contains_key("params")
        {
            out.fail(
                IrInvariantId::ErrorRoleParams,
                &at,
                format!(
                    "A role binding has 'params' if and only if the code '{}' declares params.",
                    js_text_of(value.get("code"))
                ),
            );
        }

        let eaches = each_pointers(binding.get("params"))?;

        for each in &eaches {
            if eaches
                .iter()
                .any(|outer| each.starts_with(&format!("{outer}/as")))
            {
                out.fail(
                    IrInvariantId::ErrorRoleParams,
                    &format!("{at}/params{each}"),
                    "Role params hold no 'each' inside another 'each'.".to_owned(),
                );
            }
        }
    }

    Ok(())
}

// The property of the code's params schema a retry header reads its delay from.
fn retry_param_of<'entries>(
    declaration: &JsonObject,
    schema_entries: &'entries JsonObject,
    param: Option<&JsonValue>,
) -> Option<&'entries JsonObject> {
    let schema = object_of(entry(schema_entries, declaration.get("params")));

    items_of(schema.and_then(|schema| schema.get("properties")))
        .iter()
        .filter_map(|property| object_of(Some(property)))
        .find(|property| property.get("name") == param)
}

// Why a retry header's param cannot render as a non-negative safe integer, if it cannot.
fn retry_param_problem(property: Option<&JsonObject>) -> Option<String> {
    let Some(property) = property else {
        return Some("a required, non-nullable property of the code's params".to_owned());
    };

    if !matches!(property.get("optional"), Some(JsonValue::Bool(false)))
        || !matches!(property.get("nullable"), Some(JsonValue::Bool(false)))
    {
        return Some("a required, non-nullable property of the code's params".to_owned());
    }

    let empty = JsonObject::new();
    let type_use = object_of(property.get("type")).unwrap_or(&empty);
    let refinements = object_of(type_use.get("refinements")).unwrap_or(&empty);

    if !is_text(type_use.get("kind"), "scalar")
        || !is_text(type_use.get("type"), "integer")
        || type_use.contains_key("format")
    {
        return Some("an integer scalar".to_owned());
    }

    let minimum = refinements.get("minimum").map_or(f64::NAN, js_number_of);
    let maximum = refinements.get("maximum").map_or(f64::NAN, js_number_of);

    if !refinements.contains_key("minimum") || minimum.is_nan() || minimum < 0.0 {
        return Some("an integer with a minimum of at least 0".to_owned());
    }

    if !refinements.contains_key("maximum") || maximum.is_nan() || maximum > SAFE_MAXIMUM {
        return Some("an integer with a maximum of at most 9007199254740991".to_owned());
    }

    None
}

/// A retry header sits on a bucket-derived 429 code and reads a non-negative safe integer param.
pub(super) fn check_retry_header(
    value: &JsonObject,
    pointer: &str,
    errors: &JsonObject,
    schema_entries: &JsonObject,
    out: &mut Violations,
) {
    let Some(header) = object_of(value.get("retryHeader")) else {
        return;
    };
    let at = format!("{pointer}/retryHeader");
    let declaration = declaration_of(errors, value.get("code"));
    let http = object_of(declaration.and_then(|declaration| declaration.get("http")));
    let status_is_retry = matches!(
        http.and_then(|http| http.get("status")),
        Some(JsonValue::Number(status)) if status.to_f64() == RETRY_STATUS
    );

    if declaration.is_some() && !status_is_retry {
        out.fail(
            IrInvariantId::ErrorRetryHeader,
            &at,
            format!(
                "A retry header sits on a {RETRY_STATUS} code only, not on '{}'.",
                js_text_of(value.get("code"))
            ),
        );
    }

    let derived_from = object_of(header.get("derivedFrom"));

    if !is_text(
        derived_from.and_then(|derived| derived.get("derivation")),
        derivation_ids::RULE_BUCKET.as_str(),
    ) {
        out.fail(
            IrInvariantId::ErrorRetryHeader,
            &at,
            format!(
                "A retry header is derived from '{}'.",
                derivation_ids::RULE_BUCKET
            ),
        );
    }

    let Some(declaration) = declaration else {
        return;
    };
    let property = retry_param_of(declaration, schema_entries, header.get("param"));

    if let Some(problem) = retry_param_problem(property) {
        out.fail(
            IrInvariantId::ErrorRetryHeader,
            &at,
            format!(
                "The retry header's param '{}' is {problem}.",
                js_text_of(header.get("param"))
            ),
        );
    }
}

/// An error code whose params carry a sensitive value is never stored: its declaration sets
/// `noStore`.
pub(super) fn check_error_sensitive_no_store(
    declaration: &JsonObject,
    pointer: &str,
    schemas: &IrMap<SchemaId, Schema>,
    out: &mut Violations,
) {
    let no_store = matches!(declaration.get("noStore"), Some(JsonValue::Bool(true)));
    let Some(params) = text_of(declaration.get("params")) else {
        return;
    };

    if no_store {
        return;
    }

    let params = SchemaId::new(params.to_owned());

    // A params schema the document lacks is `ir.ref.resolves`' to name, not a reach.
    let reaches = find_ir_sensitive_param_reaches_skipping_missing(&params, schemas);
    let Some(found) = reaches.first() else {
        return;
    };

    out.fail(
        IrInvariantId::ErrorSensitiveNoStore,
        pointer,
        format!(
            "The params of the error carry {}, so its declaration sets 'noStore'.",
            sensitive_reach_text(found)
        ),
    );
}
