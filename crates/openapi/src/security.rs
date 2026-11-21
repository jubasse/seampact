//! The security schemes an operation uses and the `components.securitySchemes` they become.

use indexmap::IndexSet;
use seampact_ir::{
    BearerFacts, Csrf, KnownAccessRef, KnownCsrfRef, KnownIdentityRef, KnownSchemeKeyRef,
    KnownSchemeRef, KnownSignatureVerifyRef, Operation, Scheme, SchemeId, SchemeKey,
    SignatureVerify,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::ExtensionName;
use crate::emit_context::{
    EmitContext, reason_value, refuse_inconsistent, refuse_not_emitted, refuse_unknown,
    write_extension,
};
use crate::ir_text::value_source_text;
use crate::json_value::{optional_integer, optional_text, set_defined, text_value};
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
pub(crate) fn security_schemes_component(context: &mut EmitContext<'_>) -> JsonObject {
    let ir = context.ir;
    let mut component = JsonObject::new();
    let mut ids: Vec<SchemeId> = context.security_schemes.iter().cloned().collect();

    ids.sort_by(|left, right| cmp_utf16(left.as_str(), right.as_str()));

    for id in ids {
        let location = IrLocation::root().below(&["schemes", id.as_str()]);

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
            JsonValue::Object(security_scheme(context, &known, &location)),
        );
    }

    component
}

/// The security scheme object of one declared scheme.
fn security_scheme(
    context: &mut EmitContext<'_>,
    scheme: &KnownSchemeRef<'_>,
    location: &IrLocation,
) -> JsonObject {
    match scheme {
        KnownSchemeRef::Cookie(cookie) => api_key_scheme("cookie", &cookie.name),
        KnownSchemeRef::Header(header) => api_key_scheme("header", &header.name),
        KnownSchemeRef::Query(query) => api_key_scheme("query", &query.name),
        KnownSchemeRef::Basic(_) => JsonObject::from_iter([
            ("type".to_owned(), text_value("http")),
            ("scheme".to_owned(), text_value("basic")),
        ]),
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

/// The scheme object of a bearer scheme: OAuth 2, OpenID Connect, or plain HTTP bearer.
fn bearer_scheme(
    context: &mut EmitContext<'_>,
    facts: Option<&BearerFacts>,
    location: &IrLocation,
) -> JsonObject {
    let oauth2 = facts.and_then(|facts| facts.oauth2.as_ref());
    let open_id_connect_url = facts.and_then(|facts| facts.open_id_connect_url.as_deref());

    if oauth2.is_some() && open_id_connect_url.is_some() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiSchemeBearer,
            "A bearer scheme with both OAuth 2 flows and an OpenID Connect URL",
            location,
        );
    }

    if let Some(oauth2) = oauth2 {
        return JsonObject::from_members([
            ("type", JsonValue::text("oauth2")),
            ("flows", oauth2.flows.clone()),
        ]);
    }

    if let Some(url) = open_id_connect_url {
        return JsonObject::from_members([
            ("type", JsonValue::text("openIdConnect")),
            ("openIdConnectUrl", JsonValue::text(url)),
        ]);
    }

    let mut scheme = JsonObject::from_members([
        ("type", JsonValue::text("http")),
        ("scheme", JsonValue::text("bearer")),
    ]);

    set_defined(
        &mut scheme,
        "bearerFormat",
        optional_text(facts.and_then(|facts| facts.format.as_deref())),
    );

    scheme
}

/// The `apiKey` scheme of a signature in a header, with its verification as an extension.
fn signature_scheme(
    context: &mut EmitContext<'_>,
    header_name: Option<&str>,
    signature: &SignatureVerify,
    location: &IrLocation,
) -> JsonObject {
    let mut scheme = JsonObject::from_members([
        ("type", JsonValue::text("apiKey")),
        ("in", JsonValue::text("header")),
    ]);

    match header_name {
        None => refuse_inconsistent(
            context,
            "signature.header",
            "A signature scheme without its header",
            location,
        ),
        Some(name) => {
            scheme.insert("name".to_owned(), JsonValue::text(name));
        }
    }

    let Ok(known) = KnownSignatureVerifyRef::try_from(signature) else {
        refuse_unknown(context, &location.below(&["verify"]), signature.tag());

        return scheme;
    };
    let key_location = location.below(&["key"]);
    let value = match known {
        KnownSignatureVerifyRef::Template(template) => {
            let mut value = JsonObject::from_members([
                ("verify", JsonValue::text("template")),
                ("format", JsonValue::text(&template.format)),
                ("algorithm", JsonValue::text(&template.algorithm)),
                ("payload", JsonValue::text(&template.payload)),
                ("encoding", JsonValue::text(template.encoding.as_str())),
            ]);

            set_defined(
                &mut value,
                "toleranceMs",
                optional_integer(template.tolerance_ms),
            );
            set_defined(
                &mut value,
                "key",
                scheme_key_value(context, &template.key, &key_location).map(JsonValue::Object),
            );

            value
        }
        KnownSignatureVerifyRef::Application(application) => {
            let headers = application
                .headers
                .iter()
                .map(|header| JsonValue::text(header));
            let mut value = JsonObject::from_members([
                ("verify", JsonValue::text("application")),
                ("headers", JsonValue::Array(headers.collect())),
            ]);

            if let Some(key) = &application.key {
                set_defined(
                    &mut value,
                    "key",
                    scheme_key_value(context, key, &key_location).map(JsonValue::Object),
                );
            }

            value
        }
    };

    write_extension(
        context,
        &mut scheme,
        ExtensionName::Signature,
        JsonValue::Object(value),
    );

    scheme
}

/// The key a signature is verified with: its id, or where the request carries it.
fn scheme_key_value(
    context: &mut EmitContext<'_>,
    key: &SchemeKey,
    location: &IrLocation,
) -> Option<JsonObject> {
    let Ok(known) = KnownSchemeKeyRef::try_from(key) else {
        refuse_unknown(context, &location.below(&["kind"]), key.tag());

        return None;
    };

    Some(match known {
        KnownSchemeKeyRef::Value(value) => {
            JsonObject::from_members([("value", JsonValue::text(&value.value))])
        }
        KnownSchemeKeyRef::Source(source) => JsonObject::from_members([(
            "from",
            JsonValue::text(&value_source_text(
                context,
                &source.from,
                &location.below(&["from"]),
            )),
        )]),
    })
}

/// The schemes an identity reads an optional request through, for a safe operation only.
fn optional_read_schemes(
    context: &EmitContext<'_>,
    operation: &Operation,
    identity_id: &str,
) -> Vec<String> {
    let Some(identity) = context.ir.identities.get(identity_id) else {
        return Vec::new();
    };

    if !operation.safe {
        return Vec::new();
    }

    match KnownIdentityRef::try_from(identity) {
        Ok(KnownIdentityRef::Credential(credential)) => credential
            .schemes
            .optional_read
            .iter()
            .map(|scheme| scheme.as_str().to_owned())
            .collect(),
        Ok(KnownIdentityRef::Signed(_)) | Err(_) => Vec::new(),
    }
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
pub(crate) fn write_operation_security(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    let Ok(access) = KnownAccessRef::try_from(&operation.access) else {
        refuse_unknown(
            context,
            &location.below(&["access", "kind"]),
            operation.access.tag(),
        );

        return;
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
                optional_read_schemes(context, operation, optional.identity.as_str());
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
}
