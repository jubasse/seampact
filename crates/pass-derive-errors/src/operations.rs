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
    DerivationId, DerivedFrom, ErrorCode, ErrorRole, ErrorRoleBinding, Layer, OperationError,
    Origin, RetryHeader, RetryUnit, Template, ValueSourceIn,
};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_id_param;
use seampact_pipeline::{
    DERIVATION_TABLE, DatumRequired, DraftIr, PACK_DERIVATION_ROW, PassError, TreeNodeKind,
    TreeNodes, pipeline_rate_limit_param,
};

use crate::attached::{
    DeriveErrorsAttachedCode, derive_errors_attached, derive_errors_identity_attached,
};
use crate::bindings::{
    DeriveErrorsBinding, DeriveErrorsBindingCheck, DeriveErrorsBoundParams,
    DeriveErrorsOperationSite, derive_errors_binding_at, derive_errors_binding_key,
    derive_errors_check_conditional_datum, derive_errors_params_site,
};
use crate::read::derive_errors_origin_of;
use crate::relays::{DERIVE_ERRORS_RELAY_DERIVATION, DeriveErrorsRelayCode};
use crate::report::DeriveErrorsReporter;
use crate::retry_param::derive_errors_check_retry_param;
use crate::role_params::{DeriveErrorsRoleParams, derive_errors_read_role_params};
use crate::triggers::{
    DeriveErrorsRoute, DeriveErrorsTriggerSources, derive_errors_rejects_input_field,
    derive_errors_triggers,
};

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
) -> Result<Option<Template>, InternalError> {
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
    sources: &DeriveErrorsOperationsSources<'_>,
    route: &DeriveErrorsRoute<'_>,
    binding: &DeriveErrorsBinding<'_>,
    checked: &mut HashSet<String>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let key = derive_errors_binding_key(binding);
    let pointer = match &binding.pointer {
        Some(pointer) => Some(pointer.as_str()),
        None => sources
            .check
            .registry
            .get(binding.code.as_str())
            .and_then(|registered| registered.pointer.as_deref()),
    };

    // A default binding to the core code carries the pointer by name; one refused already
    // reported its fault.
    let Some(pointer) = pointer else {
        return Ok(());
    };
    let refused = matches!(
        sources.bound.get(&key),
        Some(DeriveErrorsRoleParams::Refused)
    );

    if checked.contains(&key) || refused {
        return Ok(());
    }

    checked.insert(key);

    let Some(site) = derive_errors_params_site(&sources.check, binding, pointer)? else {
        return Ok(());
    };
    let Some(datum) = site
        .role
        .data
        .iter()
        .find(|candidate| candidate.required == DatumRequired::Conditional)
    else {
        return Ok(());
    };
    let params = binding_params(sources, binding, reporter)?;

    derive_errors_check_conditional_datum(
        &site,
        params.as_ref(),
        datum,
        &DeriveErrorsOperationSite {
            id: route.id.as_str(),
            pointer: &route.node.pointer,
        },
        reporter,
    )?;

    Ok(())
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
    sources: &DeriveErrorsOperationsSources<'_>,
    code: &ErrorCode,
    refused_params: &mut HashMap<String, bool>,
    from: &[Origin],
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<RetryHeader>, InternalError> {
    let conventions = sources.check.context.conventions;
    let name = conventions.get("rateLimit.header")?;
    let written = conventions.get("rateLimit.unit")?;
    let unit = match written.map(|reading| reading.value) {
        Some(JsonValue::String(text)) => RetryUnit::known(text),
        _ => None,
    };
    let param = pipeline_rate_limit_param(*conventions)?;

    let (Some(JsonValue::String(name)), Some(unit), Some(param)) =
        (name.map(|reading| reading.value), unit, param)
    else {
        return Ok(None);
    };

    // A param that cannot render as a safe integer is refused (once per code) and the code carries
    // no header.
    if !derive_errors_check_retry_param(
        &sources.check,
        refused_params,
        code.as_str(),
        param,
        reporter,
    )? {
        return Ok(None);
    }

    Ok(Some(RetryHeader {
        name: name.clone(),
        param: param.to_owned(),
        unit,
        derived_from: DerivedFrom {
            derivation: BUCKET_DERIVATION,
            from: from.to_vec(),
        },
    }))
}

fn element_of(
    sources: &DeriveErrorsOperationsSources<'_>,
    error: &PendingError,
    refused_retry_params: &mut HashMap<String, bool>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<OperationError, InternalError> {
    let mut derivations: Vec<(&DerivationId, &Vec<Origin>)> = error.derivations.iter().collect();

    derivations.sort_by_key(|(derivation, _)| table_index_of(derivation.as_str()));

    let Some((first, _)) = derivations.first() else {
        return Err(InternalError::new(format!(
            "error {} was collected with no derivation",
            error.code
        )));
    };
    let collected: Vec<Origin> = derivations
        .iter()
        .flat_map(|(_, origins)| origins.iter().cloned())
        .collect();
    let mut trigger_origins = dedupe(&collected);

    trigger_origins.sort_by(compare_origins(sources));

    let mut role_params: Vec<(&ErrorRole, &Option<Template>)> = error.roles.iter().collect();

    role_params.sort_by(|(left, _), (right, _)| cmp_utf16(left.as_str(), right.as_str()));

    let roles: Vec<ErrorRoleBinding> = role_params
        .into_iter()
        .map(|(role, params)| ErrorRoleBinding {
            role: role.clone(),
            params: params.clone(),
        })
        .collect();
    let status = sources
        .check
        .registry
        .get(error.code.as_str())
        .map(|registered| registered.declaration.http.status);
    let retry_header = match &error.bucket_from {
        Some(bucket_from) if status == Some(RATE_LIMITED_STATUS) => retry_header_of(
            sources,
            &error.code,
            refused_retry_params,
            &dedupe(bucket_from),
            reporter,
        )?,
        _ => None,
    };
    let attached = error.attached.as_ref();
    let relayed = error.relayed.as_ref();
    let example = attached
        .and_then(|attached| attached.example.as_ref())
        .or_else(|| relayed.and_then(|relayed| relayed.example.as_ref()));
    let origin = attached
        .and_then(|attached| attached.origin.as_ref())
        .or_else(|| relayed.and_then(|relayed| relayed.origin.as_ref()));
    let mut from = trigger_origins;

    from.extend(dedupe(&error.binding_origins));

    Ok(OperationError {
        code: error.code.clone(),
        example: example.cloned(),
        roles: if roles.is_empty() { None } else { Some(roles) },
        retry_header,
        derived_from: Some(DerivedFrom {
            derivation: (*first).clone(),
            from,
        }),
        origin: origin.cloned(),
    })
}

fn origin_key(origin: &Origin) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        origin.api.as_deref().unwrap_or(""),
        origin.layer,
        origin.pointer
    )
}

pub(crate) fn dedupe(origins: &[Origin]) -> Vec<Origin> {
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

    origin_order(layers)
}

fn origin_order(layers: Vec<Layer>) -> impl Fn(&Origin, &Origin) -> Ordering {
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
    sources: &DeriveErrorsOperationsSources<'_>,
    route: &DeriveErrorsRoute<'_>,
    forbidden_checked: &mut HashSet<String>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<IndexMap<ErrorCode, PendingError>, PassError> {
    let context = sources.check.context;
    let mut pending = IndexMap::new();
    let unread = unread_member_ids(route, sources.nodes, context.raw.merged.get("schemas"))?;
    let triggers = derive_errors_triggers(
        &DeriveErrorsTriggerSources {
            draft: sources.draft,
            unread_member_ids: &unread,
        },
        route,
    )?;

    for trigger in &triggers.roles {
        let binding =
            derive_errors_binding_at(context, sources.nodes, route.node_id, &trigger.role)?;

        // An unregistered bound code is reported at its binding (`role-code`); no element names
        // it.
        if !sources.check.registry.contains_key(binding.code.as_str()) {
            continue;
        }

        let origin = binding_origin(sources, &binding)?;
        let error = pending_of(&mut pending, &binding.code);

        add_from(error, &trigger.derivation, &trigger.from);

        if let Some(origin) = origin {
            error.binding_origins.push(origin);
        }

        if trigger.derivation == BUCKET_DERIVATION {
            error
                .bucket_from
                .get_or_insert_with(Vec::new)
                .extend(trigger.from.iter().cloned());
        }

        if !error.roles.contains_key(&trigger.role) {
            let params = binding_params(sources, &binding, reporter)?;

            error.roles.insert(trigger.role.clone(), params);
        }

        if trigger.role == ErrorRole::Forbidden
            && derive_errors_rejects_input_field(route.operation)
        {
            check_forbidden_pointer(sources, route, &binding, forbidden_checked, reporter)?;
        }
    }

    for trigger in &triggers.codes {
        let error = pending_of(&mut pending, &trigger.code);

        add_from(error, &trigger.derivation, &trigger.from);

        if trigger.derivation == BUCKET_DERIVATION {
            error
                .bucket_from
                .get_or_insert_with(Vec::new)
                .extend(trigger.from.iter().cloned());
        }
    }

    // A copied domain code keeps the roles the public operation bound it to (the declarations are
    // the same).
    for relayed in sources.relay_codes.get(route.id).into_iter().flatten() {
        let error = pending_of(&mut pending, &relayed.code);

        add_from(error, &DERIVE_ERRORS_RELAY_DERIVATION, &relayed.from);
        error.relayed = Some(relayed.clone());

        for binding in relayed.roles.iter().flatten() {
            if !error.roles.contains_key(&binding.role) {
                error
                    .roles
                    .insert(binding.role.clone(), binding.params.clone());
            }
        }
    }

    for attached in derive_errors_attached(context, sources.nodes, route)? {
        let error = pending_of(&mut pending, &attached.code);

        add_from(error, &attached.derivation.id(), &attached.from);
        error.attached = Some(attached);
    }

    // An identity's listed code keeps its list entry as origin unless a node attached it too (the
    // node's origin wins).
    for listed in derive_errors_identity_attached(context, route)? {
        let error = pending_of(&mut pending, &listed.code);
        let node_attachment = error
            .attached
            .as_ref()
            .filter(|attached| attached.origin.is_some())
            .map(|attached| attached.derivation);

        // A node attachment is the more specific: it keeps `derivedFrom`, so a relay route copies
        // the code as a domain code.
        add_from(
            error,
            &node_attachment.unwrap_or(listed.derivation).id(),
            &listed.from,
        );

        if node_attachment.is_none() {
            error.attached = Some(listed);
        }
    }

    Ok(pending)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(api: Option<&str>, layer: Layer, pointer: &str) -> Origin {
        Origin {
            api: api.map(str::to_owned),
            layer,
            pointer: pointer.to_owned(),
        }
    }

    #[test]
    fn origins_sort_by_api_then_workspace_layer_then_utf16_pointer() {
        let order = origin_order(vec![Layer::Shared, Layer::Api]);
        let astral = origin(None, Layer::Api, "/\u{10000}");
        let private_use = origin(None, Layer::Api, "/\u{E000}");
        let shared = origin(None, Layer::Shared, "/z");
        let named_api = origin(Some("a"), Layer::Shared, "/a");

        // U+10000 is the surrogate pair D800 DC00 in JavaScript, which sorts before U+E000.
        assert_eq!(order(&astral, &private_use), Ordering::Less);
        // The shared layer is listed first, then the api's.
        assert_eq!(order(&shared, &astral), Ordering::Less);
        // An origin without an api sorts before any named api.
        assert_eq!(order(&named_api, &shared), Ordering::Greater);
    }
}
