//! The rules that read an operation as a whole.

use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, object_of};

use super::decode::decode_member;
use super::deprecation::check_deprecation_headers;
use super::error_declarations::bindings_in;
use super::json_members::entry;
use super::violation::{IrInvariantId, Violations};
use crate::{
    IrError, IrMap, Response, Schema, SchemaId, find_ir_sensitive_reaches_skipping_missing,
    sensitive_reach_text,
};

/// What the rules of an operation read beside the operation.
pub(super) struct OperationScope<'doc> {
    pub(super) formats: &'doc JsonObject,
    pub(super) operations: &'doc [JsonValue],
    pub(super) api_id: Option<&'doc JsonValue>,
    pub(super) schemes: &'doc JsonObject,
    pub(super) schemas: &'doc IrMap<SchemaId, Schema>,
}

// Whether the format fills a meta member with the degraded parts; `None` for a format the
// document does not hold.
fn has_degraded_meta(formats: &JsonObject, format: Option<&JsonValue>) -> Option<bool> {
    let declaration = object_of(entry(formats, format))?;
    let meta = object_of(declaration.get("meta"));

    Some(meta.is_some_and(|meta| {
        meta.values().any(|member| {
            is_text(
                object_of(Some(member)).and_then(|member| member.get("fill")),
                "degraded",
            )
        })
    }))
}

// A role is answered by one code on an operation: one binding across its errors.
fn check_roles_once(operation: &JsonObject, pointer: &str, out: &mut Violations) {
    let mut seen: Vec<Option<&JsonValue>> = Vec::new();

    for (index, error) in items_of(operation.get("errors")).iter().enumerate() {
        let roles = object_of(Some(error)).and_then(|error| error.get("roles"));

        for (position, binding) in bindings_in(roles).iter().enumerate() {
            let role = binding.get("role");

            if seen.contains(&role) {
                out.fail(
                    IrInvariantId::OperationRoleOnce,
                    &format!("{pointer}/errors/{index}/roles/{position}"),
                    format!(
                        "The role '{}' is bound twice on the operation.",
                        js_text_of(role)
                    ),
                );
            }

            seen.push(role);
        }
    }
}

// A response that carries a sensitive value is never stored: the operation has a `cache` that
// sets `noStore`.
fn check_sensitive_no_store(
    operation: &JsonObject,
    pointer: &str,
    schemas: &IrMap<SchemaId, Schema>,
    out: &mut Violations,
) -> Result<(), IrError> {
    let cache = object_of(operation.get("cache"));

    if matches!(
        cache.and_then(|cache| cache.get("noStore")),
        Some(JsonValue::Bool(true))
    ) {
        return Ok(());
    }

    let responses: Vec<Response> = match operation.get("responses") {
        Some(value @ JsonValue::Array(_)) => decode_member(Some(value))?,
        _ => Vec::new(),
    };

    // A response schema the document lacks is `ir.ref.resolves`' to name, not a reach.
    let reaches = find_ir_sensitive_reaches_skipping_missing(&responses, schemas);
    let Some(found) = reaches.first() else {
        return Ok(());
    };

    out.fail(
        IrInvariantId::CacheSensitiveNoStore,
        pointer,
        format!(
            "A response carries {}, so the operation's 'cache' sets 'noStore'.",
            sensitive_reach_text(found)
        ),
    );

    Ok(())
}

/// The degradable header, the deprecation headers, the role bindings and the no-store of a
/// sensitive response.
///
/// # Errors
///
/// [`IrError::Decode`] when a part the typed helpers read does not decode.
pub(super) fn check_operation_members(
    operation: &JsonObject,
    pointer: &str,
    scope: &OperationScope<'_>,
    out: &mut Violations,
) -> Result<(), IrError> {
    let degradable = object_of(operation.get("degradable"));

    if degradable.is_some_and(|degradable| !degradable.contains_key("header"))
        && has_degraded_meta(scope.formats, operation.get("format")) == Some(false)
    {
        out.fail(
            IrInvariantId::DegradableHeader,
            &format!("{pointer}/degradable"),
            format!(
                "A degradable operation whose format '{}' has no 'degraded' meta member has 'header'.",
                js_text_of(operation.get("format"))
            ),
        );
    }

    check_deprecation_headers(operation, pointer, scope.operations, scope.api_id, out)?;
    check_roles_once(operation, pointer, out);

    check_sensitive_no_store(operation, pointer, scope.schemas, out)
}

/// An unsafe operation that accepts a cookie scheme has `csrf`.
pub(super) fn check_cookie_csrf(
    operation: &JsonObject,
    pointer: &str,
    schemes: &JsonObject,
    out: &mut Violations,
) {
    if !matches!(operation.get("safe"), Some(JsonValue::Bool(false))) {
        return;
    }

    let Some(access) = object_of(operation.get("access")) else {
        return;
    };

    if !is_text(access.get("kind"), "identity") && !is_text(access.get("kind"), "optional") {
        return;
    }

    let cookie = items_of(access.get("schemes")).iter().any(|id| {
        let scheme = object_of(entry(schemes, Some(id)));

        is_text(scheme.and_then(|scheme| scheme.get("kind")), "cookie")
    });

    if cookie && !operation.contains_key("csrf") {
        out.fail(
            IrInvariantId::CsrfCookie,
            pointer,
            "An unsafe operation reached through a cookie scheme has 'csrf'.".to_owned(),
        );
    }
}
