//! The per-operation members of the half (ADR 0004 section 7): each operation tree.nodes wrote,
//! matched back to the tree node it was written from, gets its access, caller kinds, CSRF
//! decision, principal requirements and bindings, and the raw-body and unknown-key facts of its
//! declared input. An operation whose access is refused gets none of them; its error is
//! reported. A relay route's `safe` is copied by tree.nodes from the public operation it relays.

use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{IrMap, Origin, Schema, SchemaId};
use seampact_pipeline::{
    AccessIdentityOperation, DraftIr, DraftOperation, PassError, TreeNode, TreeNodeId,
    TreeNodeKind, TreeNodes,
};

use crate::access::{
    AccessIdentityBuilt, AccessIdentityRoute, AccessIdentityScope, access_identity_access,
    access_identity_caller_kinds,
};
use crate::bindings::{access_identity_bindings, access_identity_principal_requires};
use crate::csrf::access_identity_csrf;
use crate::known::KnownIdentity;
use crate::params::access_identity_check_query_schemes;
use crate::report::{AccessIdentityReporter, access_identity_once_reporter};
use crate::service::{access_identity_service_caller, access_identity_service_nodes};
use crate::signed::{
    AccessIdentityInputFacts, access_identity_check_signature_key, access_identity_input_facts,
};

/// The node kinds tree.nodes writes an operation for: a route, a relay route, an `ops` entry.
pub(crate) const ACCESS_IDENTITY_OPERATION_NODE_KINDS: &[TreeNodeKind] =
    &[TreeNodeKind::Route, TreeNodeKind::Relay, TreeNodeKind::Op];

fn origin_key(origin: &Origin) -> String {
    format!("{}:{}", origin.layer, origin.pointer)
}

/// What the per-operation members of every operation of the draft are: one entry each, in draft
/// order, or `None` for a route whose access was refused.
pub(crate) type AccessIdentityWrittenOperations = Vec<Option<AccessIdentityOperation>>;

/// Writes the per-operation members of every operation of the draft.
pub(crate) fn access_identity_operations(
    draft: &DraftIr,
    built: &AccessIdentityBuilt,
    catalogue_reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<AccessIdentityWrittenOperations, PassError> {
    let mut reporter = access_identity_once_reporter(catalogue_reporter);
    let nodes = reporter.inherited().nodes();
    let caller = access_identity_service_caller(reporter.raw()).map(str::to_owned);

    if let Some(caller) = &caller {
        access_identity_service_nodes(nodes, caller, &mut reporter)?;
    }

    let schemas: &IrMap<SchemaId, Schema> = &draft.schemas;
    let mut scope = AccessIdentityScope {
        reporter: &mut reporter,
        built,
        schemas,
        caller,
    };
    let node_by_origin = operation_nodes(nodes)?;
    let mut written = Vec::with_capacity(draft.operations.len());

    for operation in &draft.operations {
        let route = route_of(operation, &node_by_origin)?;

        written.push(write_operation(&route, &mut scope)?);
    }

    Ok(written)
}

fn write_operation(
    route: &AccessIdentityRoute<'_, '_>,
    scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<Option<AccessIdentityOperation>, PassError> {
    let Some(resolved) = access_identity_access(route, scope)? else {
        return Ok(None);
    };

    let caller_kinds = access_identity_caller_kinds(&resolved.access)?;
    let csrf = access_identity_csrf(route, &resolved, scope)?;
    let principal_requires = access_identity_principal_requires(route, &resolved, scope)?;
    let bindings = access_identity_bindings(route, &resolved, scope)?;

    access_identity_check_signature_key(route, &resolved, scope)?;
    access_identity_check_query_schemes(route, &resolved, scope)?;

    let facts = write_input_facts(route.operation, resolved.identity)?;

    Ok(Some(AccessIdentityOperation {
        access: resolved.access,
        caller_kinds,
        principal_requires,
        bindings,
        csrf,
        raw_body: facts.as_ref().map(|facts| facts.raw_body),
        unknown_keys: facts.and_then(|facts| facts.unknown_keys),
    }))
}

// The facts the input receives: `unknownKeys` only on a `ref` input, the one use carrying it.
fn write_input_facts(
    operation: &DraftOperation,
    identity: Option<KnownIdentity<'_>>,
) -> Result<Option<AccessIdentityInputFacts>, InternalError> {
    let facts = access_identity_input_facts(operation, identity)?;
    let (Some(facts), Some(input)) = (facts, &operation.input) else {
        return Ok(None);
    };
    let is_ref = matches!(input.schema, seampact_ir::TypeUse::Ref(_));

    Ok(Some(AccessIdentityInputFacts {
        raw_body: facts.raw_body,
        unknown_keys: facts.unknown_keys.filter(|_| is_ref),
    }))
}

fn operation_nodes<'run>(
    nodes: &'run TreeNodes<'run>,
) -> Result<HashMap<String, (TreeNodeId, &'run TreeNode<'run>)>, InternalError> {
    let mut by_origin = HashMap::new();

    for (id, node) in nodes.iter() {
        if !ACCESS_IDENTITY_OPERATION_NODE_KINDS.contains(&node.kind) {
            continue;
        }

        let key = origin_key(&node.origin);

        if by_origin.contains_key(&key) {
            return Err(InternalError::new(format!(
                "two operation nodes share the origin {key}"
            )));
        }

        by_origin.insert(key, (id, node));
    }

    Ok(by_origin)
}

// tree.nodes writes each operation with its node's origin, an id, and `safe` beside its method, a
// relay route's copied from the operation it relays.
fn route_of<'draft, 'run>(
    operation: &'draft DraftOperation,
    node_by_origin: &HashMap<String, (TreeNodeId, &'run TreeNode<'run>)>,
) -> Result<AccessIdentityRoute<'draft, 'run>, InternalError> {
    let (Some(id), Some(origin)) = (&operation.id, &operation.origin) else {
        return Err(InternalError::new(
            "tree.nodes wrote an operation without its id or origin",
        ));
    };

    let key = origin_key(origin);
    let Some(&(node_id, node)) = node_by_origin.get(&key) else {
        return Err(InternalError::new(format!(
            "operation '{id}' has no tree node at {key}"
        )));
    };

    let Some(safe) = operation.safe else {
        return Err(InternalError::new(format!(
            "operation '{id}' at {} has no safe, which tree.nodes writes beside its method",
            node.pointer
        )));
    };

    Ok(AccessIdentityRoute {
        id: id.as_str(),
        node_id,
        node,
        safe,
        operation,
    })
}
