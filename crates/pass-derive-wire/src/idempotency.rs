//! The idempotency key (`idempotency.write`, A34, ADR 0002 section 13, ADR 0006 section 5).
//! Opt-in: an unset `conventions.idempotency` derives no key. The key reaches a non-safe operation
//! whose method `methods` lists and whose identity is not signed. There, an inherited
//! `idempotency: { exempt }` is written as the exemption; otherwise `idempotency` holds the
//! convention's settings, the key header parameter follows, and with `enforce: boundary` the replay
//! header goes on every success response. A written exemption that reaches no operation the key
//! reaches is a compile error naming the unused reason.

use std::collections::HashSet;

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    ExemptIdempotency, IdempotencyEnforcement, Identity, KnownAccessRef, KnownIdempotency, Origin,
    Reason,
};
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{ConventionReading, NearestSetting, PassError, parse_duration};

use crate::not_ported::not_ported_yet;
use crate::report::{DeriveWireProblem, DeriveWireRule};
use crate::routes::{
    DeriveWireRoute, DeriveWireScope, derive_wire_access_of, derive_wire_origin_at,
};

/// The idempotency convention, read once per api.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireIdempotencyConvention {
    pub(crate) header: String,
    pub(crate) replay_header: String,
    pub(crate) lifetime_ms: i64,
    pub(crate) methods: Vec<String>,
    pub(crate) required: bool,
    pub(crate) enforce: IdempotencyEnforcement,
    pub(crate) origin: Origin,
}

/// Tracks which written exemptions an operation the key reaches inherits.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DeriveWireExemptions {
    /// The pointers of the nodes whose exemption is used. Lookup only.
    pub(crate) used: HashSet<String>,
}

/// The convention as read: unset, refused (and reported), or its settings.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DeriveWireIdempotencyReading {
    Unset,
    Refused,
    Set(DeriveWireIdempotencyConvention),
}

/// The exemption a node writes.
#[derive(Debug, Clone, PartialEq)]
struct WrittenExemption {
    node_pointer: String,
    reason: String,
}

/// Reads `conventions.idempotency`, reporting one that misses a member without a default.
///
/// # Errors
///
/// An internal error for a member the authoring schema refuses, or [`PassError::NotPortedYet`]
/// when the convention is incomplete.
pub(crate) fn derive_wire_idempotency_convention(
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<DeriveWireIdempotencyReading, PassError> {
    let conventions = scope.context.conventions;
    // `methods` defaults only within a written `idempotency`, so its reading tells whether the
    // convention is set.
    let Some(methods) = conventions.get("idempotency.methods")? else {
        return Ok(DeriveWireIdempotencyReading::Unset);
    };
    let header = text_of(conventions.get("idempotency.header")?.as_ref(), "header")?;
    let replay_header = text_of(
        conventions.get("idempotency.replayHeader")?.as_ref(),
        "replayHeader",
    )?;
    let lifetime = text_of(
        conventions.get("idempotency.lifetime")?.as_ref(),
        "lifetime",
    )?;
    let lifetime_ms = match &lifetime {
        Some(text) => parse_duration(text)?.and_then(|ms| i64::try_from(ms).ok()),
        None => None,
    };
    let origin = convention_origin(scope)?;

    let (Some(header), Some(replay_header), Some(lifetime_ms)) =
        (header.clone(), replay_header.clone(), lifetime_ms)
    else {
        report_incomplete(
            header.as_deref(),
            replay_header.as_deref(),
            lifetime.as_deref(),
            &origin,
            scope,
        )?;

        return Ok(DeriveWireIdempotencyReading::Refused);
    };

    Ok(DeriveWireIdempotencyReading::Set(
        DeriveWireIdempotencyConvention {
            header,
            replay_header,
            lifetime_ms,
            methods: string_list(&methods)?,
            required: !matches!(
                conventions
                    .get("idempotency.required")?
                    .map(|reading| reading.value),
                Some(JsonValue::Bool(false))
            ),
            enforce: enforcement_of(conventions.get("idempotency.enforce")?.as_ref())?,
            origin,
        },
    ))
}

/// Writes the route's idempotency member, key parameter and replay header.
///
/// # Errors
///
/// An internal error for an exemption that is no mapping, or [`PassError::NotPortedYet`] until
/// the key writer is ported.
pub(crate) fn derive_wire_idempotency(
    route: &DeriveWireRoute,
    reading: &DeriveWireIdempotencyReading,
    exemptions: &mut DeriveWireExemptions,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let inherited = scope.context.inherited;
    let exemption = inherited.nearest(route.node, &NearestSetting::Idempotency)?;
    let DeriveWireIdempotencyReading::Set(convention) = reading else {
        return Ok(());
    };

    if !key_reaches(route, convention, scope)? {
        return Ok(());
    }

    if let Some(entry) = exemption {
        let reason = match entry.value {
            JsonValue::Object(members) => match members.get("exempt") {
                Some(JsonValue::String(reason)) => Some(reason),
                _ => None,
            },
            _ => None,
        };
        let Some(reason) = reason else {
            return Err(InternalError::new(format!(
                "the idempotency setting at {} is no exemption",
                entry.origin.pointer
            ))
            .into());
        };

        exemptions
            .used
            .insert(inherited.nodes().get(entry.node)?.pointer.clone());
        scope.output_of(route.operation)?.idempotency = Some(
            KnownIdempotency::Exempt(ExemptIdempotency {
                reason: Reason::new(reason.clone()),
                origin: entry.origin,
            })
            .into(),
        );

        return Ok(());
    }

    write_key(route, convention, scope)
}

fn write_key(
    _route: &DeriveWireRoute,
    _convention: &DeriveWireIdempotencyConvention,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeKey"))
}

/// Reports each written exemption no operation the key reaches inherits. Under a refused
/// convention no route gets a key, so its exemptions are not reported again.
///
/// # Errors
///
/// An internal error when an exemption's node has no authored origin.
pub(crate) fn derive_wire_check_exemptions(
    reading: &DeriveWireIdempotencyReading,
    exemptions: &DeriveWireExemptions,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    if *reading == DeriveWireIdempotencyReading::Refused {
        return Ok(());
    }

    for written in written_exemptions(scope) {
        if exemptions.used.contains(&written.node_pointer) {
            continue;
        }

        let unset = if *reading == DeriveWireIdempotencyReading::Unset {
            ": conventions.idempotency is unset"
        } else {
            ""
        };

        scope.reporter().error(DeriveWireProblem {
            rule: DeriveWireRule::IdempotencyExemptUnused,
            message: format!(
                "the idempotency exemption {} reaches no route the idempotency key reaches{unset}",
                quote_text(&written.reason)
            ),
            fix: "Remove the exemption, or move it to the non-safe routes the key reaches (a method conventions.idempotency.methods lists, an identity that is not signed).".to_owned(),
            pointer: format!("{}/idempotency", written.node_pointer),
            related: Vec::new(),
        })?;
    }

    Ok(())
}

// The validate stage admits only `{ exempt: <reason> }` as a node's `idempotency`.
fn written_exemptions(scope: &DeriveWireScope<'_, '_, '_>) -> Vec<WrittenExemption> {
    let inherited = scope.context.inherited;

    inherited
        .nodes()
        .iter()
        .filter_map(|(_, node)| {
            let Some(JsonValue::Object(setting)) = node.settings.get("idempotency") else {
                return None;
            };
            let Some(JsonValue::String(reason)) = setting.get("exempt") else {
                return None;
            };

            Some(WrittenExemption {
                node_pointer: node.pointer.clone(),
                reason: reason.clone(),
            })
        })
        .collect()
}

fn key_reaches(
    route: &DeriveWireRoute,
    convention: &DeriveWireIdempotencyConvention,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<bool, InternalError> {
    let operation = scope.operation_of(route.operation)?;
    let (Some(safe), Some(method)) = (operation.safe, &operation.method) else {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no method or safe on operation '{}'",
            route.id
        )));
    };

    if safe
        || !convention
            .methods
            .iter()
            .any(|listed| listed == method.as_str())
    {
        return Ok(false);
    }

    let identity_id = match derive_wire_access_of(scope, route)? {
        KnownAccessRef::Public(_) => return Ok(true),
        KnownAccessRef::Identity(access) => &access.identity,
        KnownAccessRef::Optional(access) => &access.identity,
    };
    let identity = scope.draft.identities.get(identity_id.as_str());

    Ok(!matches!(identity, Some(Identity::Signed(_))))
}

// `enforce` defaults to `boundary` (ADR 0002 section 13); the authoring schema refuses any other
// value.
fn enforcement_of(
    reading: Option<&ConventionReading<'_>>,
) -> Result<IdempotencyEnforcement, InternalError> {
    let boundary = JsonValue::String("boundary".to_owned());
    let value = reading.map_or(&boundary, |reading| reading.value);
    let enforcement = match value {
        JsonValue::String(text) => IdempotencyEnforcement::known(text),
        _ => None,
    };

    enforcement.ok_or_else(|| {
        InternalError::new(format!(
            "conventions.idempotency.enforce is {}, which the authoring schema refuses",
            stringify_json(value)
        ))
    })
}

// A member left unset reads `None`; one that is no string the authoring schema refuses.
fn text_of(
    reading: Option<&ConventionReading<'_>>,
    member: &str,
) -> Result<Option<String>, InternalError> {
    match reading.map(|reading| reading.value) {
        None => Ok(None),
        Some(JsonValue::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(InternalError::new(format!(
            "conventions.idempotency.{member} is no string, which the authoring schema refuses"
        ))),
    }
}

fn string_list(reading: &ConventionReading<'_>) -> Result<Vec<String>, InternalError> {
    let JsonValue::Array(items) = reading.value else {
        return Err(not_a_list());
    };

    items
        .iter()
        .map(|item| match item {
            JsonValue::String(text) => Ok(text.clone()),
            _ => Err(not_a_list()),
        })
        .collect()
}

fn not_a_list() -> InternalError {
    InternalError::new(
        "conventions.idempotency.methods is no list of methods, which the authoring schema refuses"
            .to_owned(),
    )
}

// The pointer of `conventions.idempotency` as written: every member is written in one layer's
// mapping or another, and the methods default carries no origin, so the origin is read at the
// object itself.
fn convention_origin(scope: &DeriveWireScope<'_, '_, '_>) -> Result<Origin, InternalError> {
    derive_wire_origin_at(scope, "/conventions/idempotency")
}

fn report_incomplete(
    _header: Option<&str>,
    _replay_header: Option<&str>,
    _lifetime: Option<&str>,
    _origin: &Origin,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportIncomplete"))
}
