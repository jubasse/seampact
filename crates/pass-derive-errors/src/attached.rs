//! Attached codes (ADR 0002 section 11, ADR 0006 section 6 "Error declarations on the tree", A35):
//! the codes of `conventions.errors.every`, and those of every node's `errors` whose attachment
//! reaches the operation. `reach: subtree` (the default, or `conventions.errors.reach`) reaches
//! every operation below the node; `resource` stops at a nested collection or single. `for: reads`
//! reaches the safe operations, `writes` the others. An attached code keeps the origin of the
//! nearest node attaching it, and the nearest narrowed example wins. The codes an identity lists in
//! `errors` attach to every route it guards (grammar section 9).

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivationId, ErrorCode, KnownAccessRef, Origin};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{PassError, TreeNode, TreeNodeId, TreeNodes, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::{derive_errors_member, derive_errors_origin_of};
use crate::report::DeriveErrorsContext;
use crate::triggers::DeriveErrorsRoute;

/// The derivation that attached a code to an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveErrorsAttachedDerivation {
    NodeErrors,
    ConventionsEvery,
    IdentityAuthenticate,
}

impl DeriveErrorsAttachedDerivation {
    /// The derivation as the table writes it.
    pub(crate) const fn id(self) -> DerivationId {
        DerivationId::from_static(match self {
            Self::NodeErrors => "node.errors",
            Self::ConventionsEvery => "conventions.every",
            Self::IdentityAuthenticate => "identity.authenticate",
        })
    }
}

/// A code attached to an operation, with the derivation that attached it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsAttachedCode {
    pub(crate) derivation: DeriveErrorsAttachedDerivation,
    pub(crate) code: ErrorCode,
    pub(crate) from: Vec<Origin>,
    /// The nearest node attaching the code; absent for `conventions.errors.every`.
    pub(crate) origin: Option<Origin>,
    pub(crate) example: Option<JsonValue>,
}

// The ancestors of a node, nearest first, the node itself included.
fn lineage<'nodes, 'raw>(
    nodes: &'nodes TreeNodes<'raw>,
    node: TreeNodeId,
) -> Result<Vec<&'nodes TreeNode<'raw>>, InternalError> {
    let mut chain: Vec<&TreeNode<'raw>> = nodes
        .chain(node)?
        .into_iter()
        .map(|(_, node)| node)
        .collect();

    chain.reverse();

    Ok(chain)
}

fn for_reaches(_attachment: &JsonObject, _safe: bool) -> Result<bool, PassError> {
    Err(not_ported_yet("forReaches"))
}

/// The codes the identity of an operation's access lists in `errors`: attached to every route it
/// guards, derived from `identity.authenticate`, each with the list entry as its origin.
///
/// # Errors
///
/// An internal error when a listed code has no origin.
pub(crate) fn derive_errors_identity_attached(
    context: DeriveErrorsContext<'_>,
    route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsAttachedCode>, InternalError> {
    let Some(access) = &route.operation.access else {
        return Ok(Vec::new());
    };
    let identity = match KnownAccessRef::try_from(access)? {
        KnownAccessRef::Public(_) => return Ok(Vec::new()),
        KnownAccessRef::Identity(access) => &access.identity,
        KnownAccessRef::Optional(access) => &access.identity,
    };
    let Some(JsonValue::Object(identities)) = context.raw.merged.get("identities") else {
        return Ok(Vec::new());
    };
    let Some(JsonValue::Object(declared)) = identities.get(identity.as_str()) else {
        return Ok(Vec::new());
    };
    let Some(JsonValue::Array(listed)) = derive_errors_member(declared, "errors") else {
        return Ok(Vec::new());
    };
    let mut attached = Vec::new();

    for (index, code) in listed.iter().enumerate() {
        let JsonValue::String(code) = code else {
            continue;
        };
        let pointer = pointer_below(
            "/identities",
            &[identity.as_str(), "errors", &index.to_string()],
        );
        let origin = derive_errors_origin_of(context, &pointer)?;

        attached.push(DeriveErrorsAttachedCode {
            derivation: DeriveErrorsAttachedDerivation::IdentityAuthenticate,
            code: ErrorCode::new(code.clone()),
            from: vec![origin.clone()],
            origin: Some(origin),
            example: None,
        });
    }

    Ok(attached)
}

/// The attached codes of one operation, nearest attachment first, each code once.
///
/// # Errors
///
/// A [`PassError`] when the attachments cannot be read yet.
pub(crate) fn derive_errors_attached(
    _context: DeriveErrorsContext<'_>,
    _nodes: &TreeNodes<'_>,
    _route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsAttachedCode>, PassError> {
    Err(not_ported_yet("deriveErrorsAttached"))
}
