//! Per operation `errors` (ADR 0006 sections 5 and 6, IR section 7): the attached codes and the
//! derived ones, each code once (one element per code, `derivedFrom` the first derivation in table
//! order with every trigger's origins, then the origins of the bindings that chose the code; an
//! attached code keeps the origin of the node that attached it). A role trigger answers the code
//! its nearest binding names, written with the role and the binding's params template (`roles`); a
//! bucket rule's 429 carries the retry header of `conventions.rateLimit` (`retryHeader`). Elements
//! are sorted by status, then code (`docs/ir/09`).

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, ErrorCode, ErrorRole, Layer, OperationError, Origin, RetryHeader, Template,
    ValueSourceIn,
};
use seampact_js::cmp_utf16;
use seampact_pass_tree_shared::tree_nodes_id_param;
use seampact_pipeline::{
    DERIVATION_TABLE, DraftIr, PACK_DERIVATION_ROW, PassError, TreeNodeKind, TreeNodes,
};

use crate::attached::DeriveErrorsAttachedCode;
use crate::bindings::{
    DeriveErrorsBinding, DeriveErrorsBindingCheck, DeriveErrorsBoundParams,
    derive_errors_binding_key, derive_errors_params_site,
};
use crate::not_ported::not_ported_yet;
use crate::read::derive_errors_origin_of;
use crate::relays::DeriveErrorsRelayCode;
use crate::report::DeriveErrorsReporter;
use crate::role_params::{DeriveErrorsRoleParams, derive_errors_read_role_params};
use crate::triggers::DeriveErrorsRoute;

/// What the per-operation writer reads.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsOperationsSources<'sources> {
    pub(crate) check: DeriveErrorsBindingCheck<'sources>,
    pub(crate) draft: &'sources DraftIr,
    pub(crate) nodes: &'sources TreeNodes<'sources>,
    pub(crate) bound: &'sources DeriveErrorsBoundParams,
    /// The domain codes each relay route copies, by operation id.
    pub(crate) relay_codes: &'sources HashMap<seampact_ir::OperationId, Vec<DeriveErrorsRelayCode>>,
}

/// A code collected for one operation, before it is written as an element.
#[derive(Debug, Clone)]
struct PendingError {
    code: ErrorCode,
    derivations: IndexMap<DerivationId, Vec<Origin>>,
    binding_origins: Vec<Origin>,
    roles: IndexMap<ErrorRole, Option<Template>>,
    attached: Option<DeriveErrorsAttachedCode>,
    relayed: Option<DeriveErrorsRelayCode>,
    bucket_from: Option<Vec<Origin>>,
}

/// The status whose response carries the retry header of a bucket rule.
const RATE_LIMITED_STATUS: i64 = 429;

const BUCKET_DERIVATION: DerivationId = DerivationId::from_static("rule.bucket");

fn table_index_of(derivation: &str) -> usize {
    let index_of = |id: &str| DERIVATION_TABLE.iter().position(|row| row.id == id);

    index_of(derivation)
        .or_else(|| index_of(PACK_DERIVATION_ROW))
        .unwrap_or(DERIVATION_TABLE.len())
}

/// Every operation of the draft with its tree node, matched by the origin pointer tree.nodes sets.
///
/// # Errors
///
/// An internal error when an operation has no id or its origin is no tree node.
pub(crate) fn derive_errors_routes<'route>(
    draft: &'route DraftIr,
    nodes: &'route TreeNodes<'route>,
) -> Result<Vec<DeriveErrorsRoute<'route>>, InternalError> {
    let by_pointer: HashMap<&str, _> = nodes
        .iter()
        .map(|(id, node)| (node.pointer.as_str(), (id, node)))
        .collect();
    let mut routes = Vec::new();

    for operation in &draft.operations {
        let pointer = operation
            .origin
            .as_ref()
            .map(|origin| origin.pointer.as_str());
        let found = pointer.and_then(|pointer| by_pointer.get(pointer));

        let (Some(id), Some((node_id, node))) = (&operation.id, found) else {
            return Err(InternalError::new(format!(
                "tree.nodes wrote an operation ({}) whose origin {} is no tree node",
                operation.id.as_ref().map_or("no id", |id| id.as_str()),
                pointer.unwrap_or("(none)")
            )));
        };

        routes.push(DeriveErrorsRoute {
            id,
            node_id: *node_id,
            node,
            operation,
        });
    }

    Ok(routes)
}

// The member ids of the path of a route below one or more `member` scopes that no scope of the
// operation reads.
fn unread_member_ids(
    route: &DeriveErrorsRoute<'_>,
    nodes: &TreeNodes<'_>,
    schemas: Option<&seampact_json::JsonValue>,
) -> Result<Vec<String>, InternalError> {
    let read: HashSet<&str> = route
        .operation
        .scopes
        .iter()
        .flatten()
        .filter(|scope| scope.source.r#in == ValueSourceIn::Path)
        .filter_map(|scope| scope.source.name.as_deref())
        .collect();
    let in_path: HashSet<&str> = route
        .operation
        .params
        .iter()
        .flat_map(|params| params.path.iter())
        .map(|param| param.name.as_str())
        .collect();
    let mut unread = Vec::new();
    let mut current = Some(route.node_id);

    while let Some(id) = current {
        let node = nodes.get(id)?;

        current = node.parent;

        let Some(parent) = node.parent else {
            continue;
        };

        if node.kind != TreeNodeKind::Scope || node.name != "member" {
            continue;
        }

        let id_param = tree_nodes_id_param(nodes.get(parent)?, schemas);

        if let Some(id_param) = id_param
            && in_path.contains(id_param.as_str())
            && !read.contains(id_param.as_str())
        {
            unread.push(id_param);
        }
    }

    Ok(unread)
}

fn pending_of<'pending>(
    pending: &'pending mut IndexMap<ErrorCode, PendingError>,
    code: &ErrorCode,
) -> &'pending mut PendingError {
    pending.entry(code.clone()).or_insert_with(|| PendingError {
        code: code.clone(),
        derivations: IndexMap::new(),
        binding_origins: Vec::new(),
        roles: IndexMap::new(),
        attached: None,
        relayed: None,
        bucket_from: None,
    })
}

fn add_from(error: &mut PendingError, derivation: &DerivationId, from: &[Origin]) {
    error
        .derivations
        .entry(derivation.clone())
        .or_default()
        .extend(from.iter().cloned());
}

// The params a binding writes: its checked outcome, else (a default binding nobody redeclares) the
// by-name template, which reports nothing. `None` when the code declares no params or the binding
// was refused.
fn binding_params(
    sources: &DeriveErrorsOperationsSources<'_>,
    binding: &DeriveErrorsBinding<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<Template>, PassError> {
    if let Some(checked) = sources.bound.get(&derive_errors_binding_key(binding)) {
        return Ok(match checked {
            DeriveErrorsRoleParams::Refused => None,
            DeriveErrorsRoleParams::Written { params } => params.clone(),
        });
    }

    let pointer = binding.pointer.as_deref().unwrap_or("");
    let Some(site) = derive_errors_params_site(&sources.check, binding, pointer)? else {
        return Ok(None);
    };

    Ok(match derive_errors_read_role_params(&site, reporter)? {
        DeriveErrorsRoleParams::Refused => None,
        DeriveErrorsRoleParams::Written { params } => params,
    })
}

// `forbidden`'s pointer is required where a restricted input field is rejected: checked once per
// binding.
fn check_forbidden_pointer(
    _sources: &DeriveErrorsOperationsSources<'_>,
    _route: &DeriveErrorsRoute<'_>,
    _binding: &DeriveErrorsBinding<'_>,
    _checked: &mut HashSet<String>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkForbiddenPointer"))
}

fn binding_origin(
    sources: &DeriveErrorsOperationsSources<'_>,
    binding: &DeriveErrorsBinding<'_>,
) -> Result<Option<Origin>, InternalError> {
    binding
        .pointer
        .as_deref()
        .map(|pointer| derive_errors_origin_of(sources.check.context, pointer))
        .transpose()
}

fn retry_header_of(
    _sources: &DeriveErrorsOperationsSources<'_>,
    _code: &ErrorCode,
    _refused_params: &mut HashMap<String, bool>,
    _from: &[Origin],
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<RetryHeader>, PassError> {
    Err(not_ported_yet("retryHeaderOf"))
}

fn element_of(
    _sources: &DeriveErrorsOperationsSources<'_>,
    _error: &PendingError,
    _refused_retry_params: &mut HashMap<String, bool>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<OperationError, PassError> {
    Err(not_ported_yet("elementOf"))
}

fn origin_key(origin: &Origin) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        origin.api.as_deref().unwrap_or(""),
        origin.layer,
        origin.pointer
    )
}

fn dedupe(origins: &[Origin]) -> Vec<Origin> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for origin in origins {
        if seen.insert(origin_key(origin)) {
            unique.push(origin.clone());
        }
    }

    unique
}

// `docs/ir/09`: trigger origins by api (absent first), layer in the workspace's layer order, then
// pointer.
fn compare_origins(
    sources: &DeriveErrorsOperationsSources<'_>,
) -> impl Fn(&Origin, &Origin) -> Ordering {
    let layers: Vec<Layer> = sources
        .check
        .context
        .raw
        .layers
        .iter()
        .map(|entry| Layer::from(entry.layer.clone()))
        .collect();
    let layer_index = move |origin: &Origin| {
        layers
            .iter()
            .position(|layer| *layer == origin.layer)
            .map_or(-1, |index| i64::try_from(index).unwrap_or(i64::MAX))
    };

    move |left, right| {
        let left_api = left.api.as_deref().unwrap_or("");
        let right_api = right.api.as_deref().unwrap_or("");

        if left_api != right_api {
            return cmp_utf16(left_api, right_api);
        }

        let left_layer = layer_index(left);
        let right_layer = layer_index(right);

        if left_layer != right_layer {
            return left_layer.cmp(&right_layer);
        }

        cmp_utf16(&left.pointer, &right.pointer)
    }
}

fn collect(
    _sources: &DeriveErrorsOperationsSources<'_>,
    _route: &DeriveErrorsRoute<'_>,
    _forbidden_checked: &mut HashSet<String>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<IndexMap<ErrorCode, PendingError>, PassError> {
    Err(not_ported_yet("collect"))
}

fn registered_status(
    sources: &DeriveErrorsOperationsSources<'_>,
    code: &ErrorCode,
) -> Result<i64, InternalError> {
    let registered = sources
        .check
        .registry
        .get(code.as_str())
        .ok_or_else(|| InternalError::new(format!("error {code} is not in the registry")))?;

    Ok(registered.declaration.http.status)
}

/// The `errors` of every operation of the draft, in draft order.
///
/// # Errors
///
/// A [`PassError`] when an operation's errors cannot be collected yet.
pub(crate) fn derive_errors_operations(
    sources: &DeriveErrorsOperationsSources<'_>,
    routes: &[DeriveErrorsRoute<'_>],
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Vec<Vec<OperationError>>, PassError> {
    let mut forbidden_checked = HashSet::new();
    let mut refused_retry_params = HashMap::new();
    let mut operation_errors = Vec::new();

    for route in routes {
        let pending = collect(sources, route, &mut forbidden_checked, reporter)?;
        let mut keyed = Vec::new();

        // A listed or attached code nobody declares is reported by the registry (`error-unknown`);
        // no element names it.
        for error in pending.values() {
            if !sources.check.registry.contains_key(error.code.as_str()) {
                continue;
            }

            let element = element_of(sources, error, &mut refused_retry_params, reporter)?;

            keyed.push((registered_status(sources, &element.code)?, element));
        }

        keyed.sort_by(|(left_status, left), (right_status, right)| {
            left_status
                .cmp(right_status)
                .then_with(|| cmp_utf16(left.code.as_str(), right.code.as_str()))
        });
        operation_errors.push(keyed.into_iter().map(|(_, element)| element).collect());
    }

    Ok(operation_errors)
}
