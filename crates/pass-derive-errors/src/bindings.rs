//! Role bindings (ADR 0002 section 11, Errors and natures, ADR 0006 section 6, A35): per
//! operation, the nearest `errorRoles` binding wins, then `conventions.errors.derived` (packs
//! included), then the role's default code. A binding is a code or `{ code, params }`, `params` a
//! template over the role's data. Every written binding, and a default binding to a default code a
//! layer redeclares, must name a registered code whose params receive each datum the role marks
//! required, by name or through a template key that is a param of the code.

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::InternalError;
use seampact_ir::{ErrorCode, ErrorRole, IrMap, Schema, SchemaId, Template};
use seampact_json::JsonValue;
use seampact_pipeline::{
    DerivationRole, PassError, PerKeySetting, RoleDatum, TreeNodeId, TreeNodes, TreeSchemaService,
    derivation_roles, pipeline_rate_limit_param, pipeline_tree_nodes, pointer_below,
};

use crate::not_ported::not_ported_yet;
use crate::read::derive_errors_member;
use crate::registry::DeriveErrorsRegistry;
use crate::report::{DeriveErrorsContext, DeriveErrorsReporter};
use crate::role_params::{DeriveErrorsRoleParams, DeriveErrorsRoleParamsSite};

/// The code a role answers with where a binding applies.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsBinding<'run> {
    pub(crate) role: ErrorRole,
    pub(crate) code: ErrorCode,
    /// The `params` template; absent when each param of the code takes the datum of its name.
    pub(crate) params: Option<&'run JsonValue>,
    /// The binding's pointer in the merged raw tree; absent for the role's default code.
    pub(crate) pointer: Option<String>,
}

/// What the binding checks read; the reporter is passed beside it.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsBindingCheck<'check> {
    pub(crate) context: DeriveErrorsContext<'check>,
    pub(crate) registry: &'check DeriveErrorsRegistry,
    pub(crate) schemas: &'check IrMap<SchemaId, Schema>,
    pub(crate) service: &'check dyn TreeSchemaService,
}

/// The params each checked binding gives, by `derive_errors_binding_key`; a binding refused or
/// unregistered is absent.
pub(crate) type DeriveErrorsBoundParams = HashMap<String, DeriveErrorsRoleParams>;

const DERIVED_POINTER: &str = "/conventions/errors/derived";

// A role named in the raw tree: the authoring schema admits role names only, and the validate
// stage runs first.
fn role_of(name: &str) -> Result<&'static DerivationRole, InternalError> {
    derivation_roles()
        .iter()
        .find(|candidate| candidate.role.as_str() == name)
        .ok_or_else(|| InternalError::new(format!("the role data has no role {name}")))
}

fn written_binding<'run>(
    _role: &ErrorRole,
    _value: &'run JsonValue,
    _pointer: String,
) -> Result<DeriveErrorsBinding<'run>, PassError> {
    Err(not_ported_yet("writtenBinding"))
}

/// The api-wide binding of a role: `conventions.errors.derived`, else the role's default code.
///
/// # Errors
///
/// A [`PassError`] when the conventions or the written binding cannot be read.
pub(crate) fn derive_errors_api_binding<'run>(
    context: DeriveErrorsContext<'run>,
    role: &ErrorRole,
) -> Result<DeriveErrorsBinding<'run>, PassError> {
    let reading = context.conventions.get(&format!("errors.derived.{role}"))?;

    match reading {
        Some(reading) if reading.origin.is_some() => written_binding(
            role,
            reading.value,
            pointer_below(DERIVED_POINTER, &[role.as_str()]),
        ),
        _ => Ok(DeriveErrorsBinding {
            role: role.clone(),
            code: ErrorCode::new(role_of(role.as_str())?.default_code.to_owned()),
            params: None,
            pointer: None,
        }),
    }
}

/// The binding of a role at a tree node: the nearest `errorRoles` entry, else the api-wide binding.
///
/// # Errors
///
/// A [`PassError`] when the inherited entry or the written binding cannot be read.
pub(crate) fn derive_errors_binding_at<'run>(
    context: DeriveErrorsContext<'run>,
    nodes: &TreeNodes<'_>,
    node: TreeNodeId,
    role: &ErrorRole,
) -> Result<DeriveErrorsBinding<'run>, PassError> {
    let entries = context.inherited.per_key(node, PerKeySetting::ErrorRoles)?;
    let Some(entry) = entries
        .as_ref()
        .and_then(|entries| entries.get(role.as_str()))
    else {
        return derive_errors_api_binding(context, role);
    };
    let entry_node = nodes.get(entry.node)?;

    written_binding(
        role,
        entry.value,
        pointer_below(&entry_node.pointer, &["errorRoles", role.as_str()]),
    )
}

/// The params site of a binding to a registered code, its problems located at `pointer`.
///
/// # Errors
///
/// An internal error when the binding's role is unknown or the conventions cannot be read.
pub(crate) fn derive_errors_params_site<'check>(
    check: &DeriveErrorsBindingCheck<'check>,
    binding: &'check DeriveErrorsBinding<'check>,
    pointer: &str,
) -> Result<Option<DeriveErrorsRoleParamsSite<'check>>, InternalError> {
    let Some(registered) = check.registry.get(binding.code.as_str()) else {
        return Ok(None);
    };
    let rate_limit_param = pipeline_rate_limit_param(*check.context.conventions)?;

    Ok(Some(DeriveErrorsRoleParamsSite {
        schemas: check.schemas,
        examples: check.service,
        role: role_of(binding.role.as_str())?,
        code: &binding.code,
        params_schema: registered.declaration.params.as_ref(),
        template: binding.params,
        rate_limit_param,
        pointer: pointer.to_owned(),
    }))
}

// A required datum reaches the param it fills when a member of the params template reads it: the
// member of its param, or, for a datum filling the param of its own name, any member.
fn datum_reached(
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _params: Option<&Template>,
    _datum: &RoleDatum,
) -> Result<bool, PassError> {
    Err(not_ported_yet("datumReached"))
}

/// Whether a datum the role supplies only on some operations reaches a param of the bound code
/// where it is required (`forbidden`'s pointer on an operation with a rejected restricted input
/// field); reported at `pointer` otherwise.
///
/// # Errors
///
/// A [`PassError`] when the check cannot run yet.
pub(crate) fn derive_errors_check_conditional_datum(
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _params: Option<&Template>,
    _datum: &RoleDatum,
    _operation: &DeriveErrorsOperationSite<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsCheckConditionalDatum"))
}

/// The operation a conditional datum is reported against: its id and its tree node's pointer.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeriveErrorsOperationSite<'site> {
    pub(crate) id: &'site str,
    pub(crate) pointer: &'site str,
}

/// Whether every datum a binding must carry reaches a param; each missing datum reported.
fn check_required_data(
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _params: Option<&Template>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkRequiredData"))
}

// A checked binding's params: the template the operations write, or refused (each fault
// reported); `None` when the bound code is unregistered (`role-code` reported).
fn check_binding(
    _check: &DeriveErrorsBindingCheck<'_>,
    _binding: &DeriveErrorsBinding<'_>,
    _pointer: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<DeriveErrorsRoleParams>, PassError> {
    Err(not_ported_yet("checkBinding"))
}

/// The key of a binding in `DeriveErrorsBoundParams`: its pointer, or its role for a default
/// binding.
pub(crate) fn derive_errors_binding_key(binding: &DeriveErrorsBinding<'_>) -> String {
    binding
        .pointer
        .clone()
        .unwrap_or_else(|| format!("default {}", binding.role))
}

// A binding the check reads, keyed so a default binding whose check a written binding repeats is
// checked once.
fn plain_binding_key(role: &ErrorRole, code: &ErrorCode) -> String {
    format!("{role} {code}")
}

fn record_binding(
    check: &DeriveErrorsBindingCheck<'_>,
    binding: &DeriveErrorsBinding<'_>,
    pointer: &str,
    bound: &mut DeriveErrorsBoundParams,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let params = check_binding(check, binding, pointer, reporter)?;

    if let Some(params) = params {
        bound.insert(derive_errors_binding_key(binding), params);
    }

    Ok(())
}

/// Checks every written binding (`conventions.errors.derived` and each node's `errorRoles`), and
/// each default binding whose default code a layer or node redeclares, located at that
/// declaration.
///
/// # Errors
///
/// A [`PassError`] when a binding cannot be read or checked yet.
pub(crate) fn derive_errors_check_bindings(
    check: &DeriveErrorsBindingCheck<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsBoundParams, PassError> {
    let context = check.context;
    let written = node_bindings(context)?;
    let mut bound = DeriveErrorsBoundParams::new();

    // A written binding without params to the same code checks the same data and is located
    // nearer the author.
    let written_plain: HashSet<String> = written
        .iter()
        .filter(|binding| binding.params.is_none())
        .map(|binding| plain_binding_key(&binding.role, &binding.code))
        .collect();

    for role in derivation_roles() {
        let binding = derive_errors_api_binding(context, &role.role)?;
        let redeclared = check
            .registry
            .get(binding.code.as_str())
            .and_then(|registered| registered.pointer.clone());
        let repeated = binding.pointer.is_none()
            && written_plain.contains(&plain_binding_key(&role.role, &binding.code));
        let pointer = binding.pointer.clone().or(redeclared);

        if let Some(pointer) = pointer
            && !repeated
        {
            record_binding(check, &binding, &pointer, &mut bound, reporter)?;
        }
    }

    for binding in &written {
        if let Some(pointer) = &binding.pointer {
            record_binding(check, binding, pointer, &mut bound, reporter)?;
        }
    }

    Ok(bound)
}

fn node_bindings(
    context: DeriveErrorsContext<'_>,
) -> Result<Vec<DeriveErrorsBinding<'_>>, PassError> {
    let mut bindings = Vec::new();
    let nodes = pipeline_tree_nodes(context.raw)?;

    for (_, node) in nodes.iter() {
        let Some(JsonValue::Object(roles)) = derive_errors_member(node.settings, "errorRoles")
        else {
            continue;
        };

        for (name, value) in roles.iter() {
            bindings.push(written_binding(
                &role_of(name)?.role,
                value,
                pointer_below(&node.pointer, &["errorRoles", name]),
            )?);
        }
    }

    Ok(bindings)
}
