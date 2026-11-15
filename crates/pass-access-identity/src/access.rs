//! Who may call each operation (ADR 0002 sections 5 and 9, ADR 0004 section 7): `identity` and
//! `access` are inherited separately, the nearest winning for each, and a node setting `identity`
//! below the nearest `access` makes the identity required again. Deny by default: a route that
//! resolves to neither an identity nor a public access is refused, naming both fixes (FR-4). A
//! service api runs every route under its caller identity (FR-8). An operation node setting both
//! `identity` and a public access is refused: nothing below it could use the identity.

use indexmap::IndexSet;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    CallerKind, CredentialIdentity, IdentityAccess, IdentityId, IrMap, KnownAccess, KnownIdentity,
    KnownIdentityRef, KnownScheme, OptionalAccess, Origin, Principal, PublicAccess, Reason,
    RefusedCredential, Schema, SchemaId, SchemeId,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{
    DraftOperation, InheritedEntry, NearestSetting, PassError, TreeNode, TreeNodeId, TreeNodes,
    pointer_below,
};

use crate::read::{access_identity_is_object, access_identity_object, access_identity_string};
use crate::report::{
    AccessIdentityOnceReporter, AccessIdentityProblem, AccessIdentityRelated, AccessIdentityRule,
};
use crate::service::ACCESS_IDENTITY_SERVICE_CALLER_POINTER;

/// The catalogues this half built, for the per-operation members.
pub(crate) struct AccessIdentityBuilt {
    pub(crate) schemes: IrMap<SchemeId, KnownScheme>,
    pub(crate) identities: IrMap<IdentityId, KnownIdentity>,
}

/// What the per-operation members read besides the operation.
pub(crate) struct AccessIdentityScope<'scope, 'once, 'half, 'run> {
    pub(crate) reporter: AccessIdentityOnceReporter<'once, 'half, 'run>,
    pub(crate) built: &'scope AccessIdentityBuilt,
    pub(crate) schemas: &'scope IrMap<SchemaId, Schema>,
    /// The caller identity of a service api, which every route of it runs under.
    pub(crate) caller: Option<String>,
}

/// An operation with the tree node it was written from.
pub(crate) struct AccessIdentityRoute<'draft, 'run> {
    pub(crate) id: &'draft str,
    pub(crate) node_id: TreeNodeId,
    pub(crate) node: &'run TreeNode<'run>,
    pub(crate) safe: bool,
    pub(crate) operation: &'draft DraftOperation,
}

/// An operation's access, with the identity it runs under (none on a public route).
pub(crate) struct AccessIdentityResolved<'built> {
    pub(crate) access: KnownAccess,
    pub(crate) identity: Option<KnownIdentityRef<'built>>,
}

/// The id of an identity of the catalogue.
pub(crate) const fn access_identity_id(identity: KnownIdentityRef<'_>) -> &IdentityId {
    match identity {
        KnownIdentityRef::Credential(credential) => &credential.id,
        KnownIdentityRef::Signed(signed) => &signed.id,
    }
}

/// The principal of an identity of the catalogue.
pub(crate) const fn access_identity_principal_of(identity: KnownIdentityRef<'_>) -> &Principal {
    match identity {
        KnownIdentityRef::Credential(credential) => &credential.principal,
        KnownIdentityRef::Signed(signed) => &signed.principal,
    }
}

/// Where an identity of the catalogue is declared.
pub(crate) const fn access_identity_origin_of(identity: KnownIdentityRef<'_>) -> &Origin {
    match identity {
        KnownIdentityRef::Credential(credential) => &credential.origin,
        KnownIdentityRef::Signed(signed) => &signed.origin,
    }
}

struct IdentitySource {
    name: String,
    /// The raw pointer the identity is named at.
    pointer: String,
    origin: Origin,
}

/// Which extra scheme list a credential access reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialAccess {
    Required,
    Optional,
}

struct PublicWritten {
    reason: String,
    origin: Origin,
    pointer: String,
}

struct OptionalWritten {
    reason: String,
    on_refused: RefusedCredential,
    origin: Origin,
    pointer: String,
}

/// The access of a route; `None` when refused, with the error reported.
pub(crate) fn access_identity_access<'built>(
    route: &AccessIdentityRoute<'_, '_>,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<AccessIdentityResolved<'built>>, PassError> {
    let inherited = scope.reporter.inherited();
    let identity_entry = inherited.nearest(route.node_id, &NearestSetting::Identity)?;
    let access_entry = inherited.nearest(route.node_id, &NearestSetting::Access)?;
    let source = identity_source(identity_entry.as_ref(), scope)?;

    if let Some(access_entry) = &access_entry {
        let identity_node = identity_entry.as_ref().map(|entry| entry.node);

        if !is_below(identity_node, access_entry.node, inherited.nodes())? {
            return written_access(route, access_entry, source.as_ref(), scope);
        }
    }

    let Some(source) = source else {
        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::DenyByDefault,
            message: format!("route '{}' has no identity and no public access", route.id),
            fix: "Set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'.".to_owned(),
            pointer: route.node.pointer.clone(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    required_access(route, &source, scope)
}

/// The access an access reads schemes from; `None` on a public access.
pub(crate) fn access_identity_access_schemes(access: &KnownAccess) -> Option<&[SchemeId]> {
    match access {
        KnownAccess::Identity(identity) => Some(&identity.schemes),
        KnownAccess::Optional(optional) => Some(&optional.schemes),
        KnownAccess::Public(_) => None,
    }
}

/// The caller kinds an access admits (ADR 0004 section 7), sorted.
pub(crate) fn access_identity_caller_kinds(access: &KnownAccess) -> Vec<CallerKind> {
    match access {
        KnownAccess::Identity(_) => vec![CallerKind::Identified],
        KnownAccess::Optional(_) => vec![CallerKind::Anonymous, CallerKind::Identified],
        KnownAccess::Public(_) => vec![CallerKind::Anonymous],
    }
}

// Whether `node` sits strictly below `ancestor`: the identity set there makes the identity
// required again.
fn is_below(
    node: Option<TreeNodeId>,
    ancestor: TreeNodeId,
    nodes: &TreeNodes<'_>,
) -> Result<bool, InternalError> {
    let Some(node) = node else {
        return Ok(false);
    };

    if node == ancestor {
        return Ok(false);
    }

    let mut at = nodes.get(node)?.parent;

    while let Some(current) = at {
        if current == ancestor {
            return Ok(true);
        }

        at = nodes.get(current)?.parent;
    }

    Ok(false)
}

fn identity_source(
    entry: Option<&InheritedEntry<'_>>,
    scope: &AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Option<IdentitySource>, InternalError> {
    if let Some(entry) = entry {
        let node = scope.reporter.inherited().nodes().get(entry.node)?;

        // The authoring schema writes an identity as its name.
        let JsonValue::String(name) = entry.value else {
            return Err(InternalError::new(format!(
                "the identity set at {} is not a name",
                node.pointer
            )));
        };

        return Ok(Some(IdentitySource {
            name: name.clone(),
            pointer: pointer_below(&node.pointer, &["identity"]),
            origin: entry.origin.clone(),
        }));
    }

    let Some(caller) = &scope.caller else {
        return Ok(None);
    };
    let origin = scope
        .reporter
        .origin(ACCESS_IDENTITY_SERVICE_CALLER_POINTER)
        .ok_or_else(|| {
            InternalError::new(format!(
                "the service api has a caller identity, yet nothing at {ACCESS_IDENTITY_SERVICE_CALLER_POINTER}"
            ))
        })?;

    Ok(Some(IdentitySource {
        name: caller.clone(),
        pointer: ACCESS_IDENTITY_SERVICE_CALLER_POINTER.to_owned(),
        origin,
    }))
}

// `conventions.service.allowPublic`: a service api that lets a route be public or optional-auth.
fn service_public_routes_allowed(
    scope: &AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<bool, InternalError> {
    let allowed = scope.reporter.conventions().get("service.allowPublic")?;

    Ok(allowed.is_some_and(|reading| matches!(reading.value, JsonValue::Bool(true))))
}

// The identity a source names; `None` when it is refused (reported here, or with the identity
// itself).
fn identity_of<'built>(
    source: &IdentitySource,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<KnownIdentityRef<'built>>, PassError> {
    // A service api's node naming another identity is reported once, by
    // `accessIdentityServiceNodes`.
    if let Some(caller) = &scope.caller
        && source.name != *caller
    {
        return Ok(None);
    }

    let built = scope.built;

    if let Some(identity) = built.identities.get(source.name.as_str()) {
        return Ok(Some(KnownIdentityRef::from(identity)));
    }

    // An identity left out of the catalogue for an error of its own is already reported.
    let written = access_identity_object(&scope.reporter.raw().merged, "identities");

    if written.is_some_and(|identities| identities.contains_key(&source.name)) {
        return Ok(None);
    }

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::IdentityReference,
        message: format!("identity '{}' is not declared", source.name),
        fix: "Declare the identity under 'identities', or name a declared one.".to_owned(),
        pointer: source.pointer.clone(),
        related: Vec::new(),
    })?;

    Ok(None)
}

fn written_access<'built>(
    route: &AccessIdentityRoute<'_, '_>,
    entry: &InheritedEntry<'_>,
    source: Option<&IdentitySource>,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<AccessIdentityResolved<'built>>, PassError> {
    let entry_node = scope.reporter.inherited().nodes().get(entry.node)?;
    let pointer = pointer_below(&entry_node.pointer, &["access"]);
    // The authoring schema writes `access` as `{ public }` or `{ optionalAuth, onRefused? }`.
    let written = access_identity_is_object(Some(entry.value));
    let reason = written.and_then(|object| access_identity_string(object, "public"));
    let optional_reason = written.and_then(|object| access_identity_string(object, "optionalAuth"));

    let Some(written) = written.filter(|_| reason.is_some() || optional_reason.is_some()) else {
        return Err(InternalError::new(format!(
            "the access at {pointer} is neither public nor optionalAuth"
        ))
        .into());
    };

    if let Some(caller) = &scope.caller
        && !service_public_routes_allowed(scope)?
    {
        let kind = if reason.is_none() {
            "optional-auth"
        } else {
            "public"
        };

        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::ServiceAccess,
            message: format!(
                "a service api runs every route under its caller identity '{caller}', so {kind} access is refused"
            ),
            fix: "Remove 'access': the routes of a service api are identified by 'api.caller.identity', or set 'conventions.service.allowPublic: true'.".to_owned(),
            pointer,
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let origin = entry.origin.clone();

    if let Some(reason) = reason {
        let public = PublicWritten {
            reason: reason.to_owned(),
            origin,
            pointer,
        };

        return public_access(route, entry, public, scope);
    }

    let on_refused = refused_credential(access_identity_string(written, "onRefused"), &pointer)?;
    let optional = OptionalWritten {
        reason: optional_reason.unwrap_or("").to_owned(),
        on_refused,
        origin,
        pointer,
    };

    optional_access(route, optional, source, scope)
}

// The authoring schema writes `onRefused` as `anonymous` (the default) or `reject`.
fn refused_credential(
    written: Option<&str>,
    pointer: &str,
) -> Result<RefusedCredential, InternalError> {
    match written {
        None | Some("anonymous") => Ok(RefusedCredential::Anonymous),
        Some("reject") => Ok(RefusedCredential::Reject),
        Some(other) => Err(InternalError::new(format!(
            "the access at {pointer} has onRefused {}",
            stringify_json(&JsonValue::String(other.to_owned()))
        ))),
    }
}

fn public_access<'built>(
    route: &AccessIdentityRoute<'_, '_>,
    entry: &InheritedEntry<'_>,
    written: PublicWritten,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<AccessIdentityResolved<'built>>, PassError> {
    if entry.node == route.node_id && route.node.settings.contains_key("identity") {
        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::PublicIdentity,
            message: format!(
                "{} '{}' sets both an identity and public access, so its identity is never used",
                route.node.kind.as_str(),
                route.node.name
            ),
            fix: "Remove 'identity' to keep the route public, or remove 'access' to require the identity.".to_owned(),
            pointer: written.pointer,
            related: vec![AccessIdentityRelated {
                pointer: pointer_below(&route.node.pointer, &["identity"]),
                message: "the identity".to_owned(),
            }],
        })?;

        return Ok(None);
    }

    Ok(Some(AccessIdentityResolved {
        access: KnownAccess::Public(PublicAccess {
            reason: Reason::new(written.reason),
            origin: written.origin,
        }),
        identity: None,
    }))
}

fn optional_access<'built>(
    route: &AccessIdentityRoute<'_, '_>,
    written: OptionalWritten,
    source: Option<&IdentitySource>,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<AccessIdentityResolved<'built>>, PassError> {
    let Some(source) = source else {
        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::OptionalIdentity,
            message: "optional access is written where no identity reaches, so there is none to make optional".to_owned(),
            fix: "Set 'identity: <name>' on it or an ancestor, or make the access 'public' with its reason.".to_owned(),
            pointer: written.pointer,
            related: vec![AccessIdentityRelated {
                pointer: route.node.pointer.clone(),
                message: "a route it reaches".to_owned(),
            }],
        })?;

        return Ok(None);
    };

    let Some(identity) = identity_of(source, scope)? else {
        return Ok(None);
    };

    // ADR 0013: a signed route always carries the signature, so an anonymous caller never reaches
    // it.
    let credential = match identity {
        KnownIdentityRef::Signed(signed) => {
            scope.reporter.error(AccessIdentityProblem {
                rule: AccessIdentityRule::SignedAccess,
                message: format!(
                    "optional access is written under signed identity '{}', whose routes always verify a signature",
                    signed.id
                ),
                fix: "Remove 'optionalAuth' under the signed identity, or make the route public with its reason.".to_owned(),
                pointer: written.pointer,
                related: vec![AccessIdentityRelated {
                    pointer: source.pointer.clone(),
                    message: "the signed identity".to_owned(),
                }],
            })?;

            return Ok(None);
        }
        KnownIdentityRef::Credential(credential) => credential,
    };

    let Some(schemes) = credential_schemes(
        route,
        route.safe,
        credential,
        CredentialAccess::Optional,
        scope,
    )?
    else {
        return Ok(None);
    };

    Ok(Some(AccessIdentityResolved {
        access: KnownAccess::Optional(OptionalAccess {
            identity: credential.id.clone(),
            schemes,
            reason: Reason::new(written.reason),
            on_refused: written.on_refused,
            origin: written.origin,
        }),
        identity: Some(identity),
    }))
}

fn required_access<'built>(
    route: &AccessIdentityRoute<'_, '_>,
    source: &IdentitySource,
    scope: &mut AccessIdentityScope<'built, '_, '_, '_>,
) -> Result<Option<AccessIdentityResolved<'built>>, PassError> {
    let Some(identity) = identity_of(source, scope)? else {
        return Ok(None);
    };

    let credential = match identity {
        KnownIdentityRef::Signed(signed) => {
            return Ok(Some(AccessIdentityResolved {
                access: KnownAccess::Identity(IdentityAccess {
                    identity: signed.id.clone(),
                    schemes: vec![signed.signed.clone()],
                    origin: source.origin.clone(),
                }),
                identity: Some(identity),
            }));
        }
        KnownIdentityRef::Credential(credential) => credential,
    };

    let Some(schemes) = credential_schemes(
        route,
        route.safe,
        credential,
        CredentialAccess::Required,
        scope,
    )?
    else {
        return Ok(None);
    };

    Ok(Some(AccessIdentityResolved {
        access: KnownAccess::Identity(IdentityAccess {
            identity: credential.id.clone(),
            schemes,
            origin: source.origin.clone(),
        }),
        identity: Some(identity),
    }))
}

// ADR 0002 section 9: the schemes of the route's direction, and `optionalRead` on an optional
// read only, so adding a read scheme never widens writes. An access's scheme list is never empty.
fn credential_schemes(
    route: &AccessIdentityRoute<'_, '_>,
    safe: bool,
    identity: &CredentialIdentity,
    access: CredentialAccess,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Option<Vec<SchemeId>>, InternalError> {
    let list = if safe { "read" } else { "write" };
    let listed = if safe {
        &identity.schemes.read
    } else {
        &identity.schemes.write
    };
    let extra: &[SchemeId] = if access == CredentialAccess::Optional && safe {
        &identity.schemes.optional_read
    } else {
        &[]
    };
    let distinct: IndexSet<&SchemeId> = listed.iter().chain(extra).collect();
    let mut schemes: Vec<SchemeId> = distinct.into_iter().cloned().collect();

    // `Array.prototype.sort` with no comparator orders by UTF-16 code units.
    schemes.sort_by(|left, right| cmp_utf16(left.as_str(), right.as_str()));

    if !schemes.is_empty() {
        return Ok(Some(schemes));
    }

    let direction = if safe { "reads" } else { "writes" };
    let kind = if safe { "read" } else { "write" };

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::AccessSchemes,
        message: format!(
            "route '{}' is a {kind} under identity '{}', which accepts no scheme on {direction}",
            route.id, identity.id
        ),
        fix: format!(
            "List a scheme in the identity's 'schemes.{list}', or put the route under an identity that accepts {direction}."
        ),
        pointer: route.node.pointer.clone(),
        related: vec![AccessIdentityRelated {
            pointer: pointer_below("", &["identities", identity.id.as_str(), "schemes", list]),
            message: format!("the identity's {list} schemes"),
        }],
    })?;

    Ok(None)
}
