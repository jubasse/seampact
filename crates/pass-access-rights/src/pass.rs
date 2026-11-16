//! The run of the half: catalogues, then each route's scopes, proofs, requirements, field rights,
//! sort key rights and `filteredBy`, and their write into the output.

use seampact_diagnostics::InternalError;
use seampact_ir::{FieldRight, InputProof, OperationId, OperationScope, Requirement, RightId};
use seampact_pipeline::{
    AccessRightsOperation, AccessRightsOutput, DraftOperation, DraftOperationInput, PassError,
    ProofOnlyInput, SortKeyRights,
};

use crate::bucket_keys::{AccessRightsBucketKeysInput, access_rights_check_bucket_keys};
use crate::catalogues::{AccessRightsCatalogues, access_rights_catalogues};
use crate::field_rights::{AccessRightsFieldRightsInput, access_rights_field_rights};
use crate::field_subjects::AccessRightsFieldRoute;
use crate::filtered_by::access_rights_filtered_by;
use crate::packs::{
    AccessRightsDeriveEntry, DerivedRightInput, access_rights_declare_right,
    access_rights_derive_entries, access_rights_selects,
};
use crate::proofs::{AccessRightsProofs, AccessRightsProofsInput, access_rights_proofs};
use crate::read::access_rights_member;
use crate::report::{AccessRightsReporter, access_rights_reporter, report_queued};
use crate::requires::{
    AccessRightsItemChecks, AccessRightsRequiresInput, access_rights_check_requirement_entries,
    access_rights_item_checks, access_rights_requirements,
};
use crate::restricted_fields::{AccessRightsPositionWalk, access_rights_restriction_reaching};
use crate::restricted_positions::access_rights_refuse_error_params;
use crate::restrictions::{AccessRightsRestrictionChecks, access_rights_restriction_checks};
use crate::routes::{
    AccessRightsApi, AccessRightsRoute, access_rights_api, access_rights_operation_of,
    access_rights_routes,
};
use crate::schema_use::AccessRightsContext;
use crate::scopes::access_rights_operation_scopes;
use crate::sort_keys::{
    AccessRightsSortKeyRights, AccessRightsSortKeysInput, access_rights_sort_key_rights,
};

/// The input of a route after its proofs: the input it ends with, its proofs and the body
/// proofs refused while building them.
#[derive(Debug, Clone)]
pub(crate) struct InputAfterProofs {
    pub(crate) input: Option<DraftOperationInput>,
    pub(crate) proofs: Vec<InputProof>,
    pub(crate) refused_proofs: Vec<String>,
}

/// What one route's builders produced, written to its operation at the end of the run.
struct BuiltRoute {
    scopes: Vec<OperationScope>,
    requires: Vec<Requirement>,
    proofs: AccessRightsProofs,
    field_rights: Vec<FieldRight>,
    filtered_by: Option<String>,
    sort_keys: AccessRightsSortKeyRights,
}

/// Runs the half: builds the catalogues and each route's members into the context's output.
///
/// # Errors
///
/// An internal error.
pub(crate) fn access_rights_run(context: &mut AccessRightsContext) -> Result<(), PassError> {
    let draft = context.draft;
    let mut reporter = access_rights_reporter();
    let api = access_rights_api(context);
    let mut catalogues = access_rights_catalogues(context, &mut reporter)?;
    let entries = access_rights_derive_entries(context, &draft.packs)?;
    let mut routes = Vec::new();

    for route in access_rights_routes(context, &api)? {
        let scopes =
            access_rights_operation_scopes(context, &mut reporter, &catalogues, route.node)?;

        routes.push((route, scopes));
    }

    // Every pack-derived right is declared before any requirement names one.
    for (route, scopes) in &routes {
        for entry in entries_with(&entries, "declareRight") {
            if access_rights_selects(context, entry, route, &api)? {
                access_rights_declare_right(
                    context,
                    &mut reporter,
                    &mut catalogues,
                    &DerivedRightInput {
                        entry,
                        route,
                        scopes,
                        schemas: &draft.schemas,
                    },
                )?;
            }
        }
    }

    let mut checks = access_rights_item_checks();
    let mut restrictions =
        access_rights_restriction_checks(access_rights_restriction_reaching(&draft.schemas)?);

    access_rights_check_requirement_entries(context, &mut reporter, &catalogues, &mut checks)?;
    access_rights_refuse_error_params(
        context,
        &mut AccessRightsPositionWalk {
            reporter: &mut reporter,
            schemas: &draft.schemas,
            checks: &mut restrictions,
        },
    )?;

    let mut built = Vec::with_capacity(routes.len());
    let shared = RunInputs {
        api: &api,
        entries: &entries,
    };

    for (route, scopes) in routes {
        built.push(build_route(
            context,
            &mut RunState {
                reporter: &mut reporter,
                catalogues: &catalogues,
                checks: &mut checks,
                restrictions: &mut restrictions,
            },
            &shared,
            route,
            scopes,
        )?);
    }

    write_catalogues(&mut context.output, catalogues);

    // `access_rights_routes` maps the draft's operations in order, so the two lists pair by index.
    for (index, (members, draft_operation)) in built.into_iter().zip(&draft.operations).enumerate()
    {
        let Some(operation) = context.output.operations.get_mut(index) else {
            return Err(InternalError::new(format!(
                "access.rights built no output entry for operation {index}"
            ))
            .into());
        };

        operation.scopes = members.scopes;
        operation.requires = members.requires;
        operation.field_rights = members.field_rights;
        operation.filtered_by = members.filtered_by.map(RightId::new);

        write_sort_key_rights(draft_operation, operation, &members.sort_keys)?;
        write_proofs(draft_operation, operation, members.proofs)?;
    }

    report_queued(reporter, context)?;

    Ok(())
}

/// What every route of the run reads.
struct RunInputs<'run, 'draft> {
    api: &'draft AccessRightsApi,
    entries: &'draft [AccessRightsDeriveEntry<'run>],
}

/// What the builders of a route write to as the run goes on.
struct RunState<'walk> {
    reporter: &'walk mut AccessRightsReporter,
    catalogues: &'walk AccessRightsCatalogues,
    checks: &'walk mut AccessRightsItemChecks,
    restrictions: &'walk mut AccessRightsRestrictionChecks,
}

fn build_route<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    state: &mut RunState<'_>,
    shared: &RunInputs<'run, '_>,
    route: AccessRightsRoute,
    scopes: Vec<OperationScope>,
) -> Result<BuiltRoute, PassError> {
    let draft = context.draft;
    let RunState {
        reporter,
        catalogues,
        checks,
        restrictions,
    } = state;
    let (api, entries) = (shared.api, shared.entries);

    let requires = access_rights_requirements(
        context,
        reporter,
        catalogues,
        checks,
        &AccessRightsRequiresInput {
            route: &route,
            scopes: &scopes,
            api,
            entries,
            schemas: &draft.schemas,
        },
    )?;
    let proofs = access_rights_proofs(
        context,
        reporter,
        catalogues,
        &AccessRightsProofsInput {
            route: route.clone(),
            requires: requires.clone(),
            schemas: &draft.schemas,
            identities: &draft.identities,
            schemes: &draft.schemes,
        },
    )?;
    let declared_input = access_rights_operation_of(context, &route)?.input.as_ref();
    let after_proofs = input_after_proofs(declared_input, &proofs);

    access_rights_check_bucket_keys(
        reporter,
        catalogues,
        &AccessRightsBucketKeysInput {
            route: route.clone(),
            requires: requires.clone(),
            input: after_proofs.input.as_ref(),
            proofs: after_proofs.proofs,
            refused_proofs: after_proofs.refused_proofs,
            schemas: &draft.schemas,
        },
    )?;

    let field_rights = access_rights_field_rights(
        context,
        reporter,
        catalogues,
        restrictions,
        &AccessRightsFieldRightsInput {
            field_route: AccessRightsFieldRoute {
                route: route.clone(),
                scopes: scopes.clone(),
            },
            schemas: &draft.schemas,
        },
    )?;
    let filtered_by = access_rights_filtered_by(context, reporter, catalogues, &route)?;
    let sort_keys = access_rights_sort_key_rights(
        context,
        reporter,
        catalogues,
        restrictions,
        &AccessRightsSortKeysInput {
            route,
            scopes: scopes.clone(),
            schemas: &draft.schemas,
        },
    )?;

    Ok(BuiltRoute {
        scopes,
        requires,
        proofs,
        field_rights,
        filtered_by,
        sort_keys,
    })
}

/// The input a route ends with and its body proofs, for the bucket keys that read the body.
pub(crate) fn input_after_proofs(
    declared: Option<&DraftOperationInput>,
    proofs: &AccessRightsProofs,
) -> InputAfterProofs {
    let input = proofs.created_input.as_ref().or(declared);
    let proofs_of_input = match &proofs.created_input {
        Some(created) => created.proofs.clone().unwrap_or_default(),
        None => proofs.proofs.clone(),
    };

    InputAfterProofs {
        input: input.cloned(),
        proofs: proofs_of_input,
        refused_proofs: proofs.refused_body_proofs.clone(),
    }
}

/// Writes a route's proofs: a created input in one assignment, a declared one gaining its proofs
/// only.
///
/// # Errors
///
/// An internal error for header proofs with no params, body proofs with no input, or a created
/// input missing a member.
pub(crate) fn write_proofs(
    draft_operation: &DraftOperation,
    operation: &mut AccessRightsOperation,
    proofs: AccessRightsProofs,
) -> Result<(), InternalError> {
    let operation_id = draft_operation
        .id
        .as_ref()
        .map_or("(no id)", OperationId::as_str);

    if !proofs.headers.is_empty() {
        if draft_operation.params.is_none() {
            return Err(InternalError::new(format!(
                "tree.nodes wrote no params on operation {operation_id}"
            )));
        }

        operation.header_params.extend(proofs.headers);
    }

    if let Some(created) = proofs.created_input {
        operation.proof_only_input = Some(proof_only_input_of(created, operation_id)?);

        return Ok(());
    }

    if proofs.proofs.is_empty() {
        return Ok(());
    }

    if draft_operation.input.is_none() {
        return Err(InternalError::new(format!(
            "access.rights built body proofs for operation {operation_id}, which has no input"
        )));
    }

    operation.input_proofs = Some(proofs.proofs);

    Ok(())
}

// The created input is the proof-only input the output carries: it always has a raw body flag
// and its proofs.
fn proof_only_input_of(
    created: DraftOperationInput,
    operation_id: &str,
) -> Result<ProofOnlyInput, InternalError> {
    let (Some(raw_body), Some(proofs)) = (created.raw_body, created.proofs) else {
        return Err(InternalError::new(format!(
            "access.rights created an input for operation {operation_id} without its rawBody or proofs"
        )));
    };

    Ok(ProofOnlyInput {
        media: created.media,
        schema: created.schema,
        raw_body,
        proofs,
        origin: created.origin,
    })
}

/// Writes the rights of the sort keys that have one; every sort key of the paging gets an entry,
/// as the output holds one per sort key.
///
/// # Errors
///
/// An internal error for a right at a position the paging has no sort key at.
pub(crate) fn write_sort_key_rights(
    draft_operation: &DraftOperation,
    operation: &mut AccessRightsOperation,
    rights: &AccessRightsSortKeyRights,
) -> Result<(), InternalError> {
    let sort_key_count = draft_operation
        .paging
        .as_ref()
        .map_or(0, |paging| paging.sort_keys.len());

    operation.sort_keys = vec![SortKeyRights::default(); sort_key_count];

    for (index, right) in rights {
        let Some(sort_key) = operation.sort_keys.get_mut(*index) else {
            return Err(InternalError::new(format!(
                "access.rights found no sort key {index} on operation {}",
                draft_operation
                    .id
                    .as_ref()
                    .map_or("(no id)", OperationId::as_str)
            )));
        };

        sort_key.right = Some(RightId::new(right.right.clone()));
        sort_key.subject.clone_from(&right.subject);
        sort_key.derived_from.clone_from(&right.derived_from);
    }

    Ok(())
}

/// The entries that write `effect`.
pub(crate) fn entries_with<'run, 'entries>(
    entries: &'entries [AccessRightsDeriveEntry<'run>],
    effect: &str,
) -> Vec<&'entries AccessRightsDeriveEntry<'run>> {
    entries
        .iter()
        .filter(|entry| access_rights_member(Some(entry.settings), effect).is_some())
        .collect()
}

/// Moves the built catalogues into the output.
pub(crate) fn write_catalogues(
    output: &mut AccessRightsOutput,
    catalogues: AccessRightsCatalogues,
) {
    for (id, right) in catalogues.rights {
        output.rights.insert(id, right);
    }

    for (id, rule) in catalogues.rules {
        output.rules.insert(id, rule);
    }

    for (id, scope) in catalogues.scopes {
        output.scopes.insert(id, scope);
    }

    for (id, bucket) in catalogues.buckets {
        output.buckets.insert(id, bucket);
    }
}
