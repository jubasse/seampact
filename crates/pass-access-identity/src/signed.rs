//! The facts of a signed route that its identity decides (ADR 0013, ADR 0006 sections 3 and 5):
//! the raw body and the identity's unknown-key policy of its input (`signed.identity`,
//! `identity.unknownKeys`), and the signature key source every route of a signed identity must
//! have.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, KeysPolicy, Scheme, SignatureVerify, TypeUse, UnknownKeys,
    UnknownKeysPolicy,
};
use seampact_pipeline::{DraftOperation, PassError, pointer_below};

use crate::access::{AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope};
use crate::known::KnownIdentity;
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
    identity: Option<KnownIdentity<'_>>,
) -> Result<Option<AccessIdentityInputFacts>, InternalError> {
    let Some(input) = &operation.input else {
        return Ok(None);
    };

    let Some(KnownIdentity::Signed(signed)) = identity else {
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

    let (policy, reason) = match policy {
        KeysPolicy::Ignore(ignore) => (UnknownKeysPolicy::Ignore, ignore.reason.clone()),
        KeysPolicy::Keep(keep) => (UnknownKeysPolicy::Keep, keep.reason.clone()),
        KeysPolicy::Unknown(unknown) => {
            return Err(InternalError::new(format!(
                "access.identity read an unknown-key policy of unknown kind '{}'",
                unknown.tag()
            )));
        }
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
    scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(KnownIdentity::Signed(identity)) = resolved.identity else {
        return Ok(());
    };

    // A scheme left out of the catalogue for an error of its own is already reported.
    let Some(Scheme::Signature(scheme)) = scope.built.schemes.get(&identity.signed) else {
        return Ok(());
    };
    let key = match &scheme.signature {
        SignatureVerify::Template(template) => Some(&template.key),
        SignatureVerify::Application(application) => application.key.as_ref(),
        SignatureVerify::Unknown(_) => None,
    };
    let Some(seampact_ir::SchemeKey::Source(key)) = key else {
        return Ok(());
    };

    // The authoring schema reads a key from a named path, query or header source.
    let source = &key.from;
    let location = access_identity_is_parameter_location(source.r#in.as_str())?;
    let (Some(name), Some(location)) = (source.name.as_deref(), location) else {
        return Err(InternalError::new(format!(
            "signature scheme '{}' reads its key from an unnamed or {} source",
            scheme.id, source.r#in
        ))
        .into());
    };

    if access_identity_route_has_parameter(route.operation, location, name)? {
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
