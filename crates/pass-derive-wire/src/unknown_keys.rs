//! The api's unknown-key policy for body inputs (`input.unknownKeys`, ADR 0006 section 5): a
//! `conventions.input.unknownKeys` other than `refuse` is written on every `ref` body input that
//! sets none. It is the last writer of the field: a policy on the use (tree.nodes) and a signed
//! identity's (access) win.

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivedFrom, Reason, TypeUse, UnknownKeys, UnknownKeysPolicy, derivation_ids};
use seampact_json::{JsonValue, stringify_json};

use crate::routes::{DeriveWireRoute, DeriveWireScope};

const POLICIES: [(&str, UnknownKeysPolicy); 2] = [
    ("ignore", UnknownKeysPolicy::Ignore),
    ("keep", UnknownKeysPolicy::Keep),
];

/// The policy the conventions set, or `None` for `refuse`.
///
/// # Errors
///
/// An internal error for a policy the authoring schema refuses.
pub(crate) fn derive_wire_unknown_keys_policy(
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Option<UnknownKeys>, InternalError> {
    let Some(reading) = scope.context.conventions.get("input.unknownKeys")? else {
        return Ok(None);
    };
    let JsonValue::Object(members) = reading.value else {
        return Ok(None);
    };
    let policy = POLICIES.iter().find(|(name, _)| members.contains_key(name));
    let reason = policy.and_then(|(name, _)| members.get(name));

    let (Some((_, policy)), Some(JsonValue::String(reason)), Some(origin)) =
        (policy, reason, reading.origin)
    else {
        return Err(InternalError::new(format!(
            "conventions.input.unknownKeys is {}, which the authoring schema refuses",
            stringify_json(reading.value)
        )));
    };

    Ok(Some(UnknownKeys {
        policy: policy.clone(),
        reason: Some(Reason::new(reason.clone())),
        origin: None,
        derived_from: Some(DerivedFrom {
            derivation: derivation_ids::INPUT_UNKNOWN_KEYS,
            from: vec![origin],
        }),
    }))
}

/// Writes the api's policy on the route's body input when its use sets none.
///
/// # Errors
///
/// An internal error for an operation the draft lacks.
pub(crate) fn derive_wire_unknown_keys(
    route: &DeriveWireRoute,
    policy: Option<&UnknownKeys>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let schema = scope
        .operation_of(route.operation)?
        .input
        .as_ref()
        .map(|input| &input.schema);

    let (Some(policy), Some(TypeUse::Ref(reference))) = (policy, schema) else {
        return Ok(());
    };

    if reference.unknown_keys.is_some() {
        return Ok(());
    }

    scope.output_of(route.operation)?.unknown_keys = Some(policy.clone());

    Ok(())
}
