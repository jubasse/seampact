//! The facts of a signed route that its identity decides (ADR 0013, ADR 0006 sections 3 and 5):
//! the raw body and the identity's unknown-key policy of its input (`signed.identity`,
//! `identity.unknownKeys`), and the signature key source every route of a signed identity must
//! have.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, KnownIdentityRef, KnownKeysPolicyRef, KnownScheme,
    KnownSchemeKeyRef, KnownSignatureVerifyRef, TypeUse, UnknownKeys, UnknownKeysPolicy,
};
use seampact_pipeline::{DraftOperation, PassError, pointer_below};

use crate::access::{AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope};
use crate::params::{access_identity_is_parameter_location, access_identity_route_has_parameter};
use crate::report::{AccessIdentityProblem, AccessIdentityRelated, AccessIdentityRule};

/// The derivation of an unknown-key policy taken from the identity.
pub(crate) const UNKNOWN_KEYS_DERIVATION: &str = "identity.unknownKeys";

/// The input facts this half writes on an operation's declared input, read before any is
/// written.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessIdentityInputFacts {
    pub(crate) raw_body: bool,
    pub(crate) unknown_keys: Option<UnknownKeys>,
}

/// The raw body of a declared input, true on a signed identity's route and false elsewhere, and
/// on a signed route the identity's unknown-key policy for a `ref` input whose use sets none (the
/// only use carrying `unknownKeys`).
pub(crate) fn access_identity_input_facts(
    operation: &DraftOperation,
    identity: Option<KnownIdentityRef<'_>>,
) -> Result<Option<AccessIdentityInputFacts>, InternalError> {
    let Some(input) = &operation.input else {
        return Ok(None);
    };

    let Some(KnownIdentityRef::Signed(signed)) = identity else {
        return Ok(Some(AccessIdentityInputFacts {
            raw_body: false,
            unknown_keys: None,
        }));
    };

    let raw_body_only = Some(AccessIdentityInputFacts {
        raw_body: true,
        unknown_keys: None,
    });
    let Some(policy) = &signed.unknown_keys else {
        return Ok(raw_body_only);
    };
    let TypeUse::Ref(schema) = &input.schema else {
        return Ok(raw_body_only);
    };

    if schema.unknown_keys.is_some() {
        return Ok(raw_body_only);
    }

    let (policy, reason) = match KnownKeysPolicyRef::try_from(policy)? {
        KnownKeysPolicyRef::Ignore(ignore) => (UnknownKeysPolicy::Ignore, ignore.reason.clone()),
        KnownKeysPolicyRef::Keep(keep) => (UnknownKeysPolicy::Keep, keep.reason.clone()),
    };

    Ok(Some(AccessIdentityInputFacts {
        raw_body: true,
        unknown_keys: Some(UnknownKeys {
            policy,
            reason: Some(reason),
            origin: None,
            derived_from: Some(DerivedFrom {
                derivation: DerivationId::new(UNKNOWN_KEYS_DERIVATION.to_owned()),
                from: vec![signed.origin.clone()],
            }),
        }),
    }))
}

/// Reports a signed route without the parameter its signature scheme reads the key id from (ADR
/// 0013).
pub(crate) fn access_identity_check_signature_key(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<(), PassError> {
    let Some(KnownIdentityRef::Signed(identity)) = resolved.identity else {
        return Ok(());
    };

    // A scheme left out of the catalogue for an error of its own is already reported.
    let Some(KnownScheme::Signature(scheme)) = scope.built.schemes.get(&identity.signed) else {
        return Ok(());
    };
    let key = match KnownSignatureVerifyRef::try_from(&scheme.signature)? {
        KnownSignatureVerifyRef::Template(template) => Some(&template.key),
        KnownSignatureVerifyRef::Application(application) => application.key.as_ref(),
    };
    let Some(KnownSchemeKeyRef::Source(key)) = key.map(KnownSchemeKeyRef::try_from).transpose()?
    else {
        return Ok(());
    };

    // The authoring schema reads a key from a named path, query or header source.
    let source = &key.from;
    let location = access_identity_is_parameter_location(source.r#in.as_str());
    let (Some(name), Some(location)) = (source.name.as_deref(), location) else {
        return Err(InternalError::new(format!(
            "signature scheme '{}' reads its key from an unnamed or {} source",
            scheme.id, source.r#in
        ))
        .into());
    };

    if access_identity_route_has_parameter(route.operation, location, name) {
        return Ok(());
    }

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SignatureKeySource,
        message: format!(
            "route '{}' under signed identity '{}' has no {} parameter '{name}', which signature scheme '{}' reads its key id from",
            route.id, identity.id, source.r#in, scheme.id
        ),
        fix: "Declare the parameter on the route (a path placeholder, a query field or a request header), or read the key from a source every route of the identity has.".to_owned(),
        pointer: route.node.pointer.clone(),
        related: vec![AccessIdentityRelated {
            pointer: pointer_below("", &["schemes", scheme.id.as_str(), "key", "from"]),
            message: "the key source".to_owned(),
        }],
    })?;

    Ok(())
}
