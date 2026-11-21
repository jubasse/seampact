//! The security schemes an operation uses and the `components.securitySchemes` they become.

use seampact_ir::{KnownCsrfRef, KnownSchemeRef, Operation, SchemeId};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::ExtensionName;
use crate::OpenApiError;
use crate::emit_context::{
    EmitContext, reason_value, refuse_inconsistent, refuse_unknown, root_location, write_extension,
};
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
fn security_scheme(
    _context: &mut EmitContext<'_>,
    _scheme: &KnownSchemeRef<'_>,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("securityScheme"))
}
