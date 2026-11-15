//! The derived error triggers of one operation (ADR 0006 section 5): each row of the derivation
//! table whose trigger the operation meets, read from what tree.nodes, the access halves and
//! derive.wire wrote on it. A row with roles gives a role trigger, bound to a code per operation
//! later; a row with declared codes (a requirement's right or rule, a scope) gives its codes.
//! `from` holds the trigger's origins; the binding's origin is added where the role is bound.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ApiKind, ApiRole, DerivationId, ErrorCode, ErrorRole, FieldRight, InputPolicy, KnownAccessRef,
    KnownIdentityRef, KnownRequirementRef, KnownUnknownQueryRef, OperationId, Origin, PagingRole,
    Requirement,
};
use seampact_pipeline::{DraftIr, DraftOperation, PassError, TreeNode, TreeNodeId};

use crate::not_ported::not_ported_yet;

/// An operation of the draft with the tree node tree.nodes wrote it from.
#[derive(Debug, Clone)]
pub(crate) struct DeriveErrorsRoute<'route> {
    pub(crate) id: &'route OperationId,
    pub(crate) node_id: TreeNodeId,
    pub(crate) node: &'route TreeNode<'route>,
    pub(crate) operation: &'route DraftOperation,
}

/// A row that answers a role on the operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsRoleTrigger {
    pub(crate) derivation: DerivationId,
    pub(crate) role: ErrorRole,
    pub(crate) from: Vec<Origin>,
}

/// A row that answers declared codes on the operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsCodeTrigger {
    pub(crate) derivation: DerivationId,
    pub(crate) code: ErrorCode,
    pub(crate) from: Vec<Origin>,
}

/// The triggers of one operation.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct DeriveErrorsTriggers {
    pub(crate) roles: Vec<DeriveErrorsRoleTrigger>,
    pub(crate) codes: Vec<DeriveErrorsCodeTrigger>,
}

/// The parts of the draft the triggers read besides the operation.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeriveErrorsTriggerSources<'sources> {
    pub(crate) draft: &'sources DraftIr,
    /// The member id parameters of the operation's path that no scope reads, from
    /// `unread_member_ids`.
    pub(crate) unread_member_ids: &'sources [String],
}

const GATEWAY_ROLES: [ErrorRole; 3] = [
    ErrorRole::UpstreamUnavailable,
    ErrorRole::ServiceUnavailable,
    ErrorRole::UpstreamTimeout,
];

const VERSION_TOKEN_DERIVATION: DerivationId = DerivationId::from_static("identity.versionToken");

const RULE_BUCKET_DERIVATION: DerivationId = DerivationId::from_static("rule.bucket");

const REQUIREMENT_ERRORS_DERIVATION: DerivationId = DerivationId::from_static("requirement.errors");

fn operation_origin(route: &DeriveErrorsRoute<'_>) -> Result<Origin, InternalError> {
    // tree.nodes wrote the origin of every operation; routes are matched through it.
    route.operation.origin.clone().ok_or_else(|| {
        InternalError::new(format!(
            "tree.nodes wrote no origin on operation '{}'",
            route.id
        ))
    })
}

fn role_trigger(
    derivation: &'static str,
    role: ErrorRole,
    from: Vec<Origin>,
) -> DeriveErrorsRoleTrigger {
    DeriveErrorsRoleTrigger {
        derivation: DerivationId::from_static(derivation),
        role,
        from,
    }
}

// A refused undeclared query key is an invalid input, so such an operation answers schemaInvalid
// even when it declares no input.
fn has_input(operation: &DraftOperation) -> Result<bool, InternalError> {
    if operation.input.is_some() {
        return Ok(true);
    }

    if let Some(unknown_query) = &operation.unknown_query
        && matches!(
            KnownUnknownQueryRef::try_from(unknown_query)?,
            KnownUnknownQueryRef::Refuse(_)
        )
    {
        return Ok(true);
    }

    Ok(operation
        .params
        .as_ref()
        .is_some_and(|params| params.path.len() + params.query.len() + params.header.len() > 0))
}

fn access_roles(
    sources: &DeriveErrorsTriggerSources<'_>,
    route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsRoleTrigger>, InternalError> {
    let Some(access) = &route.operation.access else {
        return Err(InternalError::new(format!(
            "access.identity wrote no access on operation '{}'",
            route.id
        )));
    };
    let (identity, origin) = match KnownAccessRef::try_from(access)? {
        KnownAccessRef::Identity(access) => (&access.identity, &access.origin),
        KnownAccessRef::Optional(access)
            if access.on_refused == seampact_ir::RefusedCredential::Reject =>
        {
            (&access.identity, &access.origin)
        }
        KnownAccessRef::Optional(_) | KnownAccessRef::Public(_) => return Ok(Vec::new()),
    };
    let mut triggers = vec![role_trigger(
        "identity.authenticate",
        ErrorRole::Unauthenticated,
        vec![origin.clone()],
    )];

    if let Some(declared) = sources.draft.identities.get(identity.as_str())
        && let KnownIdentityRef::Signed(signed) = KnownIdentityRef::try_from(declared)?
    {
        triggers.push(role_trigger(
            "signed.identity",
            ErrorRole::Unauthenticated,
            vec![signed.origin.clone()],
        ));
    }

    Ok(triggers)
}

fn write_roles(_operation: &DraftOperation) -> Result<Vec<DeriveErrorsRoleTrigger>, PassError> {
    Err(not_ported_yet("writeRoles"))
}

fn member_roles(
    _sources: &DeriveErrorsTriggerSources<'_>,
    _route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsRoleTrigger>, PassError> {
    Err(not_ported_yet("memberRoles"))
}

fn rejected_input_fields(operation: &DraftOperation) -> Vec<&FieldRight> {
    operation
        .field_rights
        .iter()
        .flatten()
        .filter(|right| {
            right.direction == seampact_ir::Direction::Input
                && right.input_policy == Some(InputPolicy::Reject)
        })
        .collect()
}

/// Whether an operation has a restricted input field whose rejection answers `forbidden`.
pub(crate) fn derive_errors_rejects_input_field(
    _operation: &DraftOperation,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsRejectsInputField"))
}

fn right_roles(operation: &DraftOperation) -> Vec<DeriveErrorsRoleTrigger> {
    let mut triggers = Vec::new();
    let rejected = rejected_input_fields(operation);

    if !rejected.is_empty() {
        let from = rejected
            .iter()
            .flat_map(|right| right.derived_from.from.iter().cloned())
            .collect();

        triggers.push(role_trigger(
            "fieldRight.restricted",
            ErrorRole::Forbidden,
            from,
        ));
    }

    if let Some(paging) = &operation.paging
        && paging.sort_keys.iter().any(|key| key.right.is_some())
    {
        triggers.push(role_trigger(
            "sortKey.restricted",
            ErrorRole::SortKeyForbidden,
            vec![paging.origin.clone()],
        ));
    }

    triggers
}

// The trigger is the `deadline` identity header: the origins derive.wire wrote it from, else the
// operation's.
fn deadline_origins(_route: &DeriveErrorsRoute<'_>) -> Result<Vec<Origin>, PassError> {
    Err(not_ported_yet("deadlineOrigins"))
}

fn wire_roles(
    sources: &DeriveErrorsTriggerSources<'_>,
    route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsRoleTrigger>, PassError> {
    let mut triggers = Vec::new();
    let operation = route.operation;

    if operation.deadline_header.is_some() {
        triggers.push(role_trigger(
            "identity.deadline",
            ErrorRole::DeadlineExceeded,
            deadline_origins(route)?,
        ));
    }

    for param in operation
        .params
        .iter()
        .flat_map(|params| params.header.iter())
    {
        if let Some(derived) = &param.derived_from
            && derived.derivation.as_str() == "union.headerTag"
        {
            triggers.push(role_trigger(
                "union.headerTag",
                ErrorRole::SchemaInvalid,
                derived.from.clone(),
            ));
        }
    }

    let Some(paging) = &operation.paging else {
        return Ok(triggers);
    };
    let Some(style) = &paging.style else {
        return Ok(triggers);
    };

    triggers.push(role_trigger(
        "paging.params",
        ErrorRole::SchemaInvalid,
        vec![paging.origin.clone()],
    ));

    let since = sources
        .draft
        .pagings
        .get(style.as_str())
        .is_some_and(|declared| {
            declared
                .request
                .iter()
                .any(|entry| entry.role == PagingRole::Since)
        });

    if since {
        triggers.push(role_trigger(
            "paging.gone",
            ErrorRole::Gone,
            vec![paging.origin.clone()],
        ));
    }

    Ok(triggers)
}

fn api_roles(
    sources: &DeriveErrorsTriggerSources<'_>,
    route: &DeriveErrorsRoute<'_>,
) -> Result<Vec<DeriveErrorsRoleTrigger>, InternalError> {
    let Some(api) = &sources.draft.api else {
        return Err(InternalError::new("tree.nodes wrote no api"));
    };
    let mut triggers = Vec::new();

    if api.role == Some(ApiRole::Gateway) {
        for role in GATEWAY_ROLES {
            triggers.push(role_trigger("api.gateway", role, vec![api.origin.clone()]));
        }
    }

    if api.kind == ApiKind::Service {
        triggers.push(role_trigger(
            "api.service",
            ErrorRole::DeadlineExceeded,
            vec![api.origin.clone()],
        ));
    }

    triggers.push(role_trigger(
        "response.undeclared",
        ErrorRole::UndeclaredStatus,
        vec![operation_origin(route)?],
    ));

    Ok(triggers)
}

fn requirement_origins(_requirement: &Requirement) -> Result<Vec<Origin>, PassError> {
    Err(not_ported_yet("requirementOrigins"))
}

// A versionToken use's `stale` code, where derive.wire wrote its request header: on the writes of
// the identity.
fn version_token_codes(
    sources: &DeriveErrorsTriggerSources<'_>,
    operation: &DraftOperation,
) -> Result<Vec<DeriveErrorsCodeTrigger>, InternalError> {
    let Some(access) = &operation.access else {
        return Ok(Vec::new());
    };
    let identity = match KnownAccessRef::try_from(access)? {
        KnownAccessRef::Public(_) => return Ok(Vec::new()),
        KnownAccessRef::Identity(access) => &access.identity,
        KnownAccessRef::Optional(access) => &access.identity,
    };
    let uses = match sources.draft.identities.get(identity.as_str()) {
        None => &[][..],
        Some(declared) => match KnownIdentityRef::try_from(declared)? {
            KnownIdentityRef::Credential(declared) => declared.headers.as_slice(),
            KnownIdentityRef::Signed(declared) => declared.headers.as_slice(),
        },
    };
    let mut codes = Vec::new();

    for param in operation
        .params
        .iter()
        .flat_map(|params| params.header.iter())
    {
        let Some(derived) = &param.derived_from else {
            continue;
        };

        if derived.derivation != VERSION_TOKEN_DERIVATION {
            continue;
        }

        let usage = uses.iter().find(|candidate| {
            sources
                .draft
                .headers
                .get(candidate.header.as_str())
                .is_some_and(|header| header.request.as_deref() == Some(param.name.as_str()))
        });

        if let Some(stale) = usage.and_then(|usage| usage.stale.as_ref()) {
            codes.push(DeriveErrorsCodeTrigger {
                derivation: VERSION_TOKEN_DERIVATION,
                code: stale.clone(),
                from: derived.from.clone(),
            });
        }
    }

    Ok(codes)
}

// A requirement's codes (`requirement.errors`), and a bucket rule's own `rule.bucket` row: its
// codes, or the `rateLimited` role when the rule declares none (ADR 0006 section 6).
fn requirement_triggers(
    sources: &DeriveErrorsTriggerSources<'_>,
    operation: &DraftOperation,
) -> Result<DeriveErrorsTriggers, PassError> {
    let mut triggers = DeriveErrorsTriggers::default();

    for requirement in operation.requires.iter().flatten() {
        let from = requirement_origins(requirement)?;

        match KnownRequirementRef::try_from(requirement)? {
            KnownRequirementRef::Right(right) => {
                let declared = sources
                    .draft
                    .rights
                    .get(right.right.as_str())
                    .map_or(&[][..], |declared| declared.errors.as_slice());

                push_declared_codes(
                    &mut triggers,
                    &REQUIREMENT_ERRORS_DERIVATION,
                    declared,
                    &from,
                );
            }
            KnownRequirementRef::Rule(rule) => {
                let declared = sources
                    .draft
                    .rules
                    .get(rule.rule.as_str())
                    .map_or(&[][..], |declared| declared.errors.as_slice());

                push_declared_codes(
                    &mut triggers,
                    &REQUIREMENT_ERRORS_DERIVATION,
                    declared,
                    &from,
                );

                if rule.bucket.is_none() {
                    continue;
                }

                if declared.is_empty() {
                    triggers.roles.push(DeriveErrorsRoleTrigger {
                        derivation: RULE_BUCKET_DERIVATION,
                        role: ErrorRole::RateLimited,
                        from: from.clone(),
                    });
                }

                push_declared_codes(&mut triggers, &RULE_BUCKET_DERIVATION, declared, &from);
            }
        }
    }

    for scope in operation.scopes.iter().flatten() {
        let declared = sources
            .draft
            .scopes
            .get(scope.scope.as_str())
            .map_or(&[][..], |declared| declared.errors.as_slice());

        push_declared_codes(
            &mut triggers,
            &DerivationId::from_static("scope.errors"),
            declared,
            std::slice::from_ref(&scope.origin),
        );
    }

    Ok(triggers)
}

fn push_declared_codes(
    triggers: &mut DeriveErrorsTriggers,
    derivation: &DerivationId,
    declared: &[ErrorCode],
    from: &[Origin],
) {
    for code in declared {
        triggers.codes.push(DeriveErrorsCodeTrigger {
            derivation: derivation.clone(),
            code: code.clone(),
            from: from.to_vec(),
        });
    }
}

/// The derived triggers of one operation, in no particular order (the writer orders by the
/// derivation table).
///
/// # Errors
///
/// A [`PassError`] when the operation cannot be read yet.
pub(crate) fn derive_errors_triggers(
    _sources: &DeriveErrorsTriggerSources<'_>,
    _route: &DeriveErrorsRoute<'_>,
) -> Result<DeriveErrorsTriggers, PassError> {
    Err(not_ported_yet("deriveErrorsTriggers"))
}
