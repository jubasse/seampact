//! The `relays` superset (ADR 0006 section 3, ADR 0002 section 7): a relay route copies the shape
//! of its public operation, so only the codes can differ. Every code of the public operation
//! outside the gateway's own derivations must be a code of the relay route.

use indexmap::IndexMap;
use seampact_diagnostics::{Diagnostic, InternalError, RuleId, Severity, quote_text};
use seampact_ir::{ContractIr, DeclarationKind, OperationError, OperationId, OperationRef};
use seampact_pipeline::{DraftIr, DraftOperation, PassError, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::origin::diagnostic_origin_of;

const LINK_RELAY_SUPERSET_RULE: &str = "seampact/link/relay-superset";

/// The rule id the relay superset check reports.
pub(crate) const RELAY_SUPERSET_RULE_ID: RuleId = RuleId::from_static(LINK_RELAY_SUPERSET_RULE);

/// The gateway's own derivations (`docs/grammar/07-routes.md` "Relays"): the access and api-wide
/// codes the gateway answers itself, which a relay route need not answer.
pub const LINK_GATEWAY_DERIVATIONS: &[&str] = &[
    "identity.authenticate",
    "signed.identity",
    "csrf.cookieWrite",
    "idempotency.write",
    "principal.requires",
    "binding.mismatch",
    "requirement.errors",
    "scope.errors",
    "fieldRight.restricted",
    "sortKey.restricted",
    "rule.bucket",
    "identity.deadline",
    "identity.versionToken",
    "api.gateway",
    "api.service",
    "response.undeclared",
    "conventions.every",
];

const SUPERSET_FIX: &str = "Bind the role to the same code in both apis, for the api with `conventions.errors.derived` or with `errorRoles` on the relay route.";

const RELAY_MEMBER: &str = "relays";

fn is_operation(
    candidate_kind: Option<&DeclarationKind>,
    candidate_id: Option<&OperationId>,
    id: &OperationId,
) -> bool {
    candidate_kind == Some(&DeclarationKind::HttpOperation) && candidate_id == Some(id)
}

// The errors of the public operation a relay route names, from a workspace draft or, else, a
// closed import.
fn public_errors_of<'run>(
    drafts: &'run IndexMap<String, DraftIr>,
    imports: &'run IndexMap<String, ContractIr>,
    relays: &OperationRef,
) -> Result<&'run [OperationError], PassError> {
    let id = &relays.id;
    let from_draft = drafts.get(&relays.api).and_then(|draft| {
        draft
            .operations
            .iter()
            .find(|operation| is_operation(operation.kind.as_ref(), operation.id.as_ref(), id))
    });

    if let Some(operation) = from_draft {
        return Ok(operation.errors.as_deref().unwrap_or(&[]));
    }

    let imported = imports.get(&relays.api).is_some_and(|contract| {
        contract
            .operations
            .iter()
            .any(|operation| is_operation(Some(&operation.kind), Some(&operation.id), id))
    });

    if imported {
        // The closed check of an imported operation is the foreign `checkIrClosedDeclaration`.
        return Err(not_ported_yet("checkIrClosedDeclaration"));
    }

    Err(InternalError::new(format!(
        "a relay route relays {}.{}, which tree.nodes found but is no closed operation of a workspace api or an import",
        relays.api, relays.id
    ))
    .into())
}

fn is_gateway_own(error: &OperationError) -> bool {
    let derivation = error
        .derived_from
        .as_ref()
        .map_or("", |derived| derived.derivation.as_str());

    LINK_GATEWAY_DERIVATIONS.contains(&derivation)
}

fn roles_text(error: &OperationError) -> String {
    let roles: Vec<String> = error
        .roles
        .iter()
        .flatten()
        .map(|binding| quote_text(&binding.role.to_string()))
        .collect();

    if roles.is_empty() {
        return String::new();
    }

    format!(" for the role {}", roles.join(", "))
}

fn superset_diagnostic(
    route: &DraftOperation,
    route_api: &str,
    relays: &OperationRef,
    missing: &OperationError,
) -> Result<Diagnostic, InternalError> {
    let route_label = route.id.as_ref().map_or("undefined", AsRef::as_ref);
    let located = route.origin.as_ref().and_then(diagnostic_origin_of);
    let Some(mut origin) = located else {
        return Err(InternalError::new(format!(
            "the relay route {route_api}.{route_label} has no authored origin"
        )));
    };

    origin.pointer = pointer_below(&origin.pointer, &[RELAY_MEMBER]);

    Ok(Diagnostic {
        severity: Severity::Error,
        rule: RELAY_SUPERSET_RULE_ID,
        message: format!(
            "The relay route {route_api}.{route_label} does not answer the code {}, which {}.{} answers{}.",
            quote_text(missing.code.as_str()),
            relays.api,
            relays.id,
            roles_text(missing)
        ),
        fix: SUPERSET_FIX.to_owned(),
        origin,
        related: Vec::new(),
    })
}

/// Reports, under the relay route's api, each code of a public operation its relay route does not
/// answer.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] for a relay to an imported operation, else an internal error.
pub(crate) fn link_relay_superset(
    drafts: &IndexMap<String, DraftIr>,
    imports: &IndexMap<String, ContractIr>,
) -> Result<Vec<(String, Diagnostic)>, PassError> {
    let mut reported = Vec::new();

    for (route_api, draft) in drafts {
        for route in &draft.operations {
            let Some(relays) = &route.relays else {
                continue;
            };

            let answered: Vec<&str> = route
                .errors
                .iter()
                .flatten()
                .map(|error| error.code.as_str())
                .collect();

            for error in public_errors_of(drafts, imports, relays)? {
                if !is_gateway_own(error) && !answered.contains(&error.code.as_str()) {
                    reported.push((
                        route_api.clone(),
                        superset_diagnostic(route, route_api, relays, error)?,
                    ));
                }
            }
        }
    }

    Ok(reported)
}

#[cfg(test)]
mod tests {
    use seampact_ir::{DerivedFrom, ErrorCode, ErrorRole, ErrorRoleBinding, Layer, Origin};
    use seampact_pipeline::DERIVATION_TABLE;

    use super::*;

    fn error_with(code: &str, derivation: Option<&str>, role: Option<ErrorRole>) -> OperationError {
        OperationError {
            code: ErrorCode::new(code.to_owned()),
            example: None,
            roles: role.map(|role| vec![ErrorRoleBinding { role, params: None }]),
            retry_header: None,
            derived_from: derivation.map(|derivation| DerivedFrom {
                derivation: seampact_ir::DerivationId::new(derivation.to_owned()),
                from: Vec::new(),
            }),
            origin: None,
        }
    }

    fn operation_with(
        id: &str,
        errors: Vec<OperationError>,
        relays: Option<&str>,
    ) -> DraftOperation {
        DraftOperation {
            kind: Some(DeclarationKind::HttpOperation),
            id: Some(OperationId::new(id.to_owned())),
            errors: Some(errors),
            relays: relays.map(|api| OperationRef {
                kind: DeclarationKind::HttpOperation,
                api: api.to_owned(),
                id: OperationId::new(id.to_owned()),
            }),
            origin: Some(Origin {
                api: None,
                layer: Layer::Api,
                pointer: "/surfaces/internal/routes/getTask".to_owned(),
            }),
            ..DraftOperation::default()
        }
    }

    fn drafts_of(
        public_errors: Vec<OperationError>,
        route_errors: Vec<OperationError>,
    ) -> IndexMap<String, DraftIr> {
        let mut public = DraftIr::new();
        let mut service = DraftIr::new();

        public
            .operations
            .push(operation_with("getTask", public_errors, None));
        service
            .operations
            .push(operation_with("getTask", route_errors, Some("tasks")));

        IndexMap::from([
            ("tasks".to_owned(), public),
            ("tasksService".to_owned(), service),
        ])
    }

    #[test]
    fn a_route_answering_every_code_reports_nothing() {
        let answered = || vec![error_with("api.not_found", None, Some(ErrorRole::NotFound))];
        let drafts = drafts_of(answered(), answered());

        assert_eq!(
            link_relay_superset(&drafts, &IndexMap::new()),
            Ok(Vec::new())
        );
    }

    #[test]
    fn a_gateway_code_need_not_be_answered_but_any_other_must() {
        let public = vec![
            error_with("api.unauthenticated", Some("identity.authenticate"), None),
            error_with("api.owned", Some("some.other"), None),
        ];
        let drafts = drafts_of(public, Vec::new());
        let reported = link_relay_superset(&drafts, &IndexMap::new());

        let messages: Vec<String> = reported
            .iter()
            .flatten()
            .map(|(api, diagnostic)| format!("{api}: {}", diagnostic.message))
            .collect();

        assert_eq!(
            messages,
            vec![
                "tasksService: The relay route tasksService.getTask does not answer the code 'api.owned', which tasks.getTask answers."
            ]
        );
    }

    #[test]
    fn a_role_bound_to_another_code_names_both_operations_the_code_the_role_and_the_fix() {
        let public = vec![error_with(
            "api.schema_invalid",
            None,
            Some(ErrorRole::SchemaInvalid),
        )];
        let service = vec![error_with(
            "api.service_invalid",
            None,
            Some(ErrorRole::SchemaInvalid),
        )];
        let drafts = drafts_of(public, service);
        let reported = link_relay_superset(&drafts, &IndexMap::new());
        let Ok(reported) = reported else {
            panic!("the check fails: {reported:?}");
        };
        let [(api, diagnostic)] = reported.as_slice() else {
            panic!("one diagnostic expected: {reported:?}");
        };

        assert_eq!(api, "tasksService");
        assert_eq!(diagnostic.rule, RELAY_SUPERSET_RULE_ID);
        assert_eq!(
            diagnostic.message,
            "The relay route tasksService.getTask does not answer the code 'api.schema_invalid', which tasks.getTask answers for the role 'schemaInvalid'."
        );
        assert_eq!(diagnostic.fix, SUPERSET_FIX);
        assert_eq!(
            diagnostic.origin.pointer,
            "/surfaces/internal/routes/getTask/relays"
        );
    }

    #[test]
    fn a_relay_naming_no_workspace_operation_nor_import_is_an_internal_error() {
        let mut drafts = drafts_of(Vec::new(), Vec::new());

        drafts.shift_remove("tasks");

        let Err(PassError::Internal(internal)) = link_relay_superset(&drafts, &IndexMap::new())
        else {
            panic!("an internal error expected");
        };

        assert!(
            internal.to_string().contains(
                "relays tasks.getTask, which tree.nodes found but is no closed operation"
            ),
            "{internal}"
        );
    }

    #[test]
    fn every_gateway_derivation_is_a_row_of_the_derivation_table() {
        let rows: Vec<&str> = DERIVATION_TABLE.iter().map(|row| row.id).collect();
        let missing: Vec<&&str> = LINK_GATEWAY_DERIVATIONS
            .iter()
            .filter(|id| !rows.contains(id))
            .collect();

        assert!(missing.is_empty(), "{missing:?}");
    }
}
