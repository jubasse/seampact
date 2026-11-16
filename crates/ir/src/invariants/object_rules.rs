//! The rules of one object of the IR, chosen by the definition the schema reads it as.

use std::collections::HashMap;

use seampact_json::{JsonObject, JsonValue};

use super::catalogue_refs::check_core_origin;
use super::deprecation::check_deprecation_dates;
use super::error_declarations::{
    check_error_sensitive_no_store, check_retry_header, check_role_params,
};
use super::exact_numbers::check_exact_numbers;
use super::input_proofs::{check_proof_input, check_proof_names, check_proof_wires};
use super::json_members::{is_listed, is_string, record, string, text_of};
use super::open_values::is_known;
use super::operation::{OperationScope, check_cookie_csrf, check_operation_members};
use super::partitions::{
    BARE_SOURCES, ID_TYPE_KINDS, KNOWN_TYPE_USE_KINDS, NAMED_SOURCES, PLAIN_WIRE_KINDS,
    PROOF_REFUSED_KINDS, QUERY_WIRE_KINDS, QUERY_WIRE_MEMBERS,
};
use super::right_subjects::{check_field_right, check_sort_key};
use super::violation::{IrInvariantId, Violations};
use crate::IrError;

/// The members of the document the rules of an object read.
pub(super) struct DocumentView<'doc> {
    pub(super) document: &'doc JsonObject,
    pub(super) schema_entries: &'doc JsonObject,
    pub(super) rights: &'doc JsonObject,
    pub(super) errors: &'doc JsonObject,
    pub(super) operation: OperationScope<'doc>,
}

/// The definition of each object seen so far, by pointer: a placement rule reads its parent's.
pub(super) type ObjectDefinitions = HashMap<String, Option<String>>;

/// Runs the rules of the definition `definition` on `value`.
///
/// # Errors
///
/// [`IrError`] when the embedded schemas are broken or a part a typed helper reads does not decode.
pub(super) fn check_object(
    definition: Option<&str>,
    value: &JsonObject,
    pointer: &str,
    view: &DocumentView<'_>,
    objects: &ObjectDefinitions,
    out: &mut Violations,
) -> Result<(), IrError> {
    match definition {
        Some("Origin") => check_core_origin(value, pointer, view.document, out),
        Some("OperationInput") => {
            check_proof_input(value, pointer, view.schema_entries, out);
            check_proof_names(value, pointer, view.schema_entries, out);
            check_proof_wires(value, pointer, out)?;
        }
        Some("Name") => check_name(value, pointer, out)?,
        Some("MetaMember") => check_meta_member(value, pointer, out)?,
        Some("ValueSource") => check_value_source(value, pointer, objects, out)?,
        Some("HeaderDecl") => check_header_declaration(value, pointer, out)?,
        Some("Cache") => check_cache(value, pointer, out),
        Some("Operation") => {
            check_operation_members(value, pointer, &view.operation, out)?;
            check_cookie_csrf(value, pointer, view.operation.schemes, out);
        }
        Some("FieldWire") => check_field_wire(value, pointer, out)?,
        Some("FieldRight") => check_field_right(value, pointer, view.rights, out)?,
        Some("SortKey") => check_sort_key(value, pointer, view.rights, out)?,
        Some("Deprecation") => check_deprecation_dates(value, pointer, out),
        Some("ErrorDecl") => {
            check_error_sensitive_no_store(value, pointer, view.operation.schemas, out);
        }
        Some("OperationError") => {
            check_role_params(value, pointer, view.errors, out)?;
            check_retry_header(value, pointer, view.errors, view.schema_entries, out);
        }
        Some("Param") => {
            check_exact_numbers(
                record(value.get("type")),
                value.get("default"),
                value.get("examples"),
                pointer,
                out,
            );
        }
        Some("ScalarTypeUse") => {
            check_exact_numbers(Some(value), None, value.get("examples"), pointer, out);
        }
        Some("Property") => check_property(value, pointer, out),
        Some("Scope" | "ResourceSubject") => check_id_type_use(value, pointer, out),
        Some("RuleProof" | "InputProof") => check_proof_type_use(value, pointer, out),
        Some("Scalar") => check_scalar(value, pointer, out),
        Some(_) | None => {}
    }

    Ok(())
}

fn check_name(value: &JsonObject, pointer: &str, out: &mut Violations) -> Result<(), IrError> {
    if !is_known("Name", "role", value.get("role"))? {
        return Ok(());
    }

    if is_string(value.get("role"), "response") != value.contains_key("status") {
        out.fail(
            IrInvariantId::NameStatus,
            pointer,
            "A name has 'status' if and only if its role is 'response'.".to_owned(),
        );
    }

    Ok(())
}

fn check_meta_member(
    value: &JsonObject,
    pointer: &str,
    out: &mut Violations,
) -> Result<(), IrError> {
    if !is_known("MetaMember", "fill", value.get("fill"))? {
        return Ok(());
    }

    if is_string(value.get("fill"), "source") != value.contains_key("source") {
        out.fail(
            IrInvariantId::MetaSource,
            pointer,
            "A $meta member has 'source' if and only if 'fill' is 'source'.".to_owned(),
        );
    }

    Ok(())
}

fn check_value_source(
    value: &JsonObject,
    pointer: &str,
    objects: &ObjectDefinitions,
    out: &mut Violations,
) -> Result<(), IrError> {
    let Some(source) = string(value.get("in")) else {
        return Ok(());
    };

    if !is_known("ValueSource", "in", value.get("in"))? {
        return Ok(());
    }

    let named = NAMED_SOURCES.contains(&source);
    let bare = BARE_SOURCES.contains(&source);

    if named && (!value.contains_key("name") || value.contains_key("prefixBits")) {
        out.fail(
            IrInvariantId::ValueSourceMembers,
            pointer,
            format!("A '{source}' source has 'name' and no 'prefixBits'."),
        );
    }

    if bare && value.contains_key("name") {
        out.fail(
            IrInvariantId::ValueSourceMembers,
            pointer,
            format!("A '{source}' source has no 'name'."),
        );
    }

    if source != "address" && bare && value.contains_key("prefixBits") {
        out.fail(
            IrInvariantId::ValueSourceMembers,
            pointer,
            "Only an 'address' source has 'prefixBits'.".to_owned(),
        );
    }

    let parent_pointer = pointer.rsplit_once('/').map_or("", |(parent, _)| parent);
    let parent = objects
        .get(parent_pointer)
        .and_then(|definition| definition.as_deref());

    if source == "resolver" && parent != Some("OperationScope") {
        out.fail(
            IrInvariantId::ValueSourcePlace,
            pointer,
            "A 'resolver' source is a scope source only.".to_owned(),
        );
    }

    if source == "holderField" && parent != Some("FieldRightSubject") {
        out.fail(
            IrInvariantId::ValueSourcePlace,
            pointer,
            "A 'holderField' source is a field right subject only.".to_owned(),
        );
    }

    Ok(())
}

fn check_header_declaration(
    value: &JsonObject,
    pointer: &str,
    out: &mut Violations,
) -> Result<(), IrError> {
    if !is_known("HeaderDecl", "semantic", value.get("semantic"))? {
        return Ok(());
    }

    let has = |member: &str| value.contains_key(member);
    let token = is_string(value.get("semantic"), "versionToken");
    let token_members = has("response") && has("request");
    let plain_members = has("name") && has("in");
    let valid = if token {
        token_members && !has("name") && !has("in")
    } else {
        plain_members && !has("response") && !has("request")
    };

    if !valid {
        let message = if token {
            "A versionToken header has 'response' and 'request', and no 'name' or 'in'."
        } else {
            "A header has 'name' and 'in', and no 'response' or 'request' (versionToken only)."
        };

        out.fail(IrInvariantId::HeaderMembers, pointer, message.to_owned());
    }

    Ok(())
}

fn check_cache(value: &JsonObject, pointer: &str, out: &mut Violations) {
    let never = is_string(value.get("family"), "never");

    if never == value.contains_key("directives") {
        out.fail(
            IrInvariantId::CacheDirectives,
            pointer,
            "Cache 'directives' are absent if and only if the family is 'never'.".to_owned(),
        );
    }

    if never && !matches!(value.get("noStore"), Some(JsonValue::Bool(true))) {
        out.fail(
            IrInvariantId::CacheDirectives,
            pointer,
            "A 'never' cache family sets 'noStore'.".to_owned(),
        );
    }
}

fn check_field_wire(
    value: &JsonObject,
    pointer: &str,
    out: &mut Violations,
) -> Result<(), IrError> {
    let kind = value.get("kind");

    if is_listed(kind, PLAIN_WIRE_KINDS) {
        if QUERY_WIRE_MEMBERS
            .iter()
            .any(|member| value.contains_key(member))
        {
            out.fail(
                IrInvariantId::FieldWireMembers,
                pointer,
                format!(
                    "A '{}' field has no style, explode or brackets.",
                    text_of(kind)
                ),
            );
        }
    } else if is_listed(kind, QUERY_WIRE_KINDS)
        && is_known("FieldWire", "kind", kind)?
        && !QUERY_WIRE_MEMBERS
            .iter()
            .all(|member| value.contains_key(member))
    {
        out.fail(
            IrInvariantId::FieldWireMembers,
            pointer,
            format!(
                "A '{}' field has style, explode and brackets.",
                text_of(kind)
            ),
        );
    }

    Ok(())
}

fn check_property(value: &JsonObject, pointer: &str, out: &mut Violations) {
    let type_use = record(value.get("type"));

    check_exact_numbers(
        type_use,
        value.get("default"),
        value.get("examples"),
        pointer,
        out,
    );

    let Some(type_use) = type_use else {
        return;
    };

    if type_use.contains_key("nullable") {
        out.fail(
            IrInvariantId::PropertyNullable,
            pointer,
            "A property's type use has no 'nullable': the property holds it.".to_owned(),
        );
    }

    if type_use.contains_key("sensitive") {
        out.fail(
            IrInvariantId::PropertySensitive,
            pointer,
            "A property's type use has no 'sensitive': the property holds it.".to_owned(),
        );
    }
}

fn check_id_type_use(value: &JsonObject, pointer: &str, out: &mut Violations) {
    let Some(type_use) = record(value.get("idSchema")) else {
        return;
    };

    if !is_listed(type_use.get("kind"), KNOWN_TYPE_USE_KINDS) {
        return;
    }

    if !is_listed(type_use.get("kind"), ID_TYPE_KINDS) || type_use.contains_key("nullable") {
        out.fail(
            IrInvariantId::IdScalar,
            &format!("{pointer}/idSchema"),
            "An id's type use is a 'scalar' or 'enum' use without 'nullable'.".to_owned(),
        );
    }
}

// A rule's proof and the body field it adds to an operation's input (`InputProof`) are typed
// alike.
fn check_proof_type_use(value: &JsonObject, pointer: &str, out: &mut Violations) {
    let Some(type_use) = record(value.get("schema")) else {
        return;
    };

    if is_listed(type_use.get("kind"), PROOF_REFUSED_KINDS) {
        out.fail(
            IrInvariantId::IdScalar,
            &format!("{pointer}/schema"),
            "A rule proof's type use is neither 'opaque' nor 'file'.".to_owned(),
        );
    }
}

fn check_scalar(value: &JsonObject, pointer: &str, out: &mut Violations) {
    if record(value.get("type")).is_some_and(|own_type| own_type.contains_key("scalar")) {
        out.fail(
            IrInvariantId::ScalarType,
            pointer,
            "A named format's own type names no 'scalar'.".to_owned(),
        );
    }
}
