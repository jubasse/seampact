//! The security schemes an operation uses and the `components.securitySchemes` they become.

use indexmap::IndexSet;
use seampact_ir::{
    BearerFacts, Csrf, KnownAccessRef, KnownCsrfRef, KnownSchemeRef, Operation, Scheme, SchemeId,
    SignatureVerify,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::ExtensionName;
use crate::OpenApiError;
use crate::emit_context::{
    EmitContext, reason_value, refuse_inconsistent, refuse_unknown, root_location, write_extension,
};
use crate::json_value::text_value;
use crate::not_ported::not_ported_yet;
use seampact_js::cmp_utf16;

/// Records that an operation uses the scheme `scheme_id`, refusing one the IR does not declare.
fn use_scheme<'id>(
    context: &mut EmitContext<'_>,
    scheme_id: &'id str,
    location: &IrLocation,
) -> &'id str {
    if context.ir.schemes.get(scheme_id).is_none() {
        refuse_inconsistent(
            context,
            "scheme.missing",
            &format!("The scheme '{scheme_id}' is not declared"),
            location,
        );
    }

    context
        .security_schemes
        .insert(SchemeId::new(scheme_id.to_owned()));

    scheme_id
}

/// Writes the mark of an operation exempt from the CSRF check.
fn write_csrf(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    let Some(csrf) = &operation.csrf else {
        return;
    };
    let Ok(known) = KnownCsrfRef::try_from(csrf) else {
        return refuse_unknown(context, &location.below(&["csrf", "kind"]), csrf.tag());
    };

    if let KnownCsrfRef::Exempt(exempt) = known {
        let value = JsonObject::from_iter([(
            "exempt".to_owned(),
            reason_value(context, exempt.reason.as_str()),
        )]);

        write_extension(
            context,
            target,
            ExtensionName::Csrf,
            JsonValue::Object(value),
        );
    }
}

/// The `components.securitySchemes` of the schemes the operations used, sorted by id.
pub(crate) fn security_schemes_component(
    context: &mut EmitContext<'_>,
) -> Result<JsonObject, OpenApiError> {
    let ir = context.ir;
    let mut component = JsonObject::new();
    let mut ids: Vec<SchemeId> = context.security_schemes.iter().cloned().collect();

    ids.sort_by(|left, right| cmp_utf16(left.as_str(), right.as_str()));

    for id in ids {
        let location = root_location().below(&["schemes", id.as_str()]);

        // A missing scheme was refused where an operation named it.
        let Some(scheme) = ir.schemes.get(id.as_str()) else {
            continue;
        };
        let Ok(known) = KnownSchemeRef::try_from(scheme) else {
            refuse_unknown(context, &location.below(&["kind"]), scheme.tag());

            continue;
        };

        component.insert(
            id.as_str().to_owned(),
            JsonValue::Object(security_scheme(context, &known, &location)?),
        );
    }

    Ok(component)
}

/// The security scheme object of one declared scheme.
///
/// # Errors
///
/// As [`bearer_scheme`] and [`signature_scheme`].
fn security_scheme(
    context: &mut EmitContext<'_>,
    scheme: &KnownSchemeRef<'_>,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    match scheme {
        KnownSchemeRef::Cookie(cookie) => Ok(api_key_scheme("cookie", &cookie.name)),
        KnownSchemeRef::Header(header) => Ok(api_key_scheme("header", &header.name)),
        KnownSchemeRef::Query(query) => Ok(api_key_scheme("query", &query.name)),
        KnownSchemeRef::Basic(_) => Ok(JsonObject::from_iter([
            ("type".to_owned(), text_value("http")),
            ("scheme".to_owned(), text_value("basic")),
        ])),
        KnownSchemeRef::Bearer(bearer) => bearer_scheme(context, bearer.bearer.as_ref(), location),
        KnownSchemeRef::Signature(signature) => signature_scheme(
            context,
            signature.name.as_deref(),
            &signature.signature,
            &location.below(&["signature"]),
        ),
    }
}

/// An `apiKey` scheme read from `place`.
fn api_key_scheme(place: &str, name: &str) -> JsonObject {
    JsonObject::from_iter([
        ("type".to_owned(), text_value("apiKey")),
        ("in".to_owned(), text_value(place)),
        ("name".to_owned(), text_value(name)),
    ])
}

fn bearer_scheme(
    _context: &mut EmitContext<'_>,
    _facts: Option<&BearerFacts>,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("bearerScheme"))
}

fn signature_scheme(
    _context: &mut EmitContext<'_>,
    _header_name: Option<&str>,
    _signature: &SignatureVerify,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("signatureScheme"))
}

fn optional_read_schemes(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _identity_id: &str,
) -> Result<Vec<String>, OpenApiError> {
    Err(not_ported_yet("optionalReadSchemes"))
}

/// The `security` requirement of each distinct scheme, a cookie's CSRF scheme alongside it.
fn requirements_of(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    scheme_ids: &[&str],
    location: &IrLocation,
) -> Vec<JsonValue> {
    let unique: IndexSet<&str> = scheme_ids.iter().copied().collect();
    let csrf_checked = matches!(operation.csrf, Some(Csrf::Derived(_)));
    let ir = context.ir;

    unique
        .into_iter()
        .map(|scheme_id| {
            let used = use_scheme(context, scheme_id, location);
            let mut requirement = JsonObject::from_iter([(used.to_owned(), empty_scopes())]);

            if let (Some(Scheme::Cookie(cookie)), true) = (ir.schemes.get(scheme_id), csrf_checked)
                && let Some(csrf) = &cookie.csrf
            {
                let csrf_used = use_scheme(context, csrf.as_str(), location);

                requirement.insert(csrf_used.to_owned(), empty_scopes());
            }

            JsonValue::Object(requirement)
        })
        .collect()
}

fn empty_scopes() -> JsonValue {
    JsonValue::Array(Vec::new())
}

/// Writes the `security` of an operation and its `x-seampact-access` mark.
///
/// # Errors
///
/// As [`optional_read_schemes`].
pub(crate) fn write_operation_security(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) -> Result<(), OpenApiError> {
    let Ok(access) = KnownAccessRef::try_from(&operation.access) else {
        refuse_unknown(
            context,
            &location.below(&["access", "kind"]),
            operation.access.tag(),
        );

        return Ok(());
    };

    match access {
        KnownAccessRef::Public(public) => {
            target.insert("security".to_owned(), empty_scopes());

            let mark = JsonObject::from_iter([(
                "public".to_owned(),
                reason_value(context, public.reason.as_str()),
            )]);

            write_extension(
                context,
                target,
                ExtensionName::Access,
                JsonValue::Object(mark),
            );
        }
        KnownAccessRef::Identity(identity) => {
            let schemes: Vec<&str> = identity.schemes.iter().map(SchemeId::as_str).collect();
            let requirements = requirements_of(context, operation, &schemes, location);
            let mark = JsonObject::from_iter([(
                "identity".to_owned(),
                text_value(identity.identity.as_str()),
            )]);

            target.insert("security".to_owned(), JsonValue::Array(requirements));
            write_extension(
                context,
                target,
                ExtensionName::Access,
                JsonValue::Object(mark),
            );
        }
        KnownAccessRef::Optional(optional) => {
            let read_schemes =
                optional_read_schemes(context, operation, optional.identity.as_str())?;
            let schemes: Vec<&str> = optional
                .schemes
                .iter()
                .map(SchemeId::as_str)
                .chain(read_schemes.iter().map(String::as_str))
                .collect();
            let mut requirements = requirements_of(context, operation, &schemes, location);
            let mark = JsonObject::from_iter([
                (
                    "identity".to_owned(),
                    text_value(optional.identity.as_str()),
                ),
                (
                    "optionalAuth".to_owned(),
                    reason_value(context, optional.reason.as_str()),
                ),
                (
                    "onRefused".to_owned(),
                    text_value(optional.on_refused.as_str()),
                ),
            ]);

            requirements.push(JsonValue::Object(JsonObject::new()));
            target.insert("security".to_owned(), JsonValue::Array(requirements));
            write_extension(
                context,
                target,
                ExtensionName::Access,
                JsonValue::Object(mark),
            );
        }
    }

    write_csrf(context, operation, target, location);

    Ok(())
}
