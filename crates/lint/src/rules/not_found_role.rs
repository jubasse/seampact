//! A declared 404 code beside the derived notFound code on a route (grammar section 11).

use indexmap::IndexMap;
use seampact_ir::{ContractIr, DerivationId, ErrorCode, ErrorRole, Operation, derivation_ids};

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::{lint_owns_origin, lint_routes_named};

const NOT_FOUND_STATUS: i64 = 404;

/// A scope, right or rule answers a parent or a subject: its 404 sits beside the member 404 on
/// purpose.
const SUBJECT_DERIVATIONS: [DerivationId; 3] = [
    derivation_ids::SCOPE_ERRORS,
    derivation_ids::REQUIREMENT_ERRORS,
    derivation_ids::RULE_BUCKET,
];

/// The routes that list one competing code.
struct CompetingRoutes<'ir> {
    operations: Vec<&'ir Operation>,
    attached_by_every_only: bool,
}

fn answers_not_found_role(operation: &Operation) -> bool {
    operation.errors.iter().any(|error| {
        error
            .roles
            .iter()
            .flatten()
            .any(|binding| binding.role == ErrorRole::NotFound)
    })
}

fn takes_not_found_role(operation: &Operation, code: &ErrorCode) -> bool {
    operation.errors.iter().any(|error| {
        error.code == *code
            && error
                .roles
                .iter()
                .flatten()
                .any(|binding| binding.role == ErrorRole::NotFound)
    })
}

fn attached_for_the_member(operation: &Operation, code: &ErrorCode) -> bool {
    operation.errors.iter().any(|error| {
        error.code == *code
            && error
                .derived_from
                .as_ref()
                .is_none_or(|derived| !SUBJECT_DERIVATIONS.contains(&derived.derivation))
    })
}

fn attached_by_every_only(operation: &Operation, code: &ErrorCode) -> bool {
    operation
        .errors
        .iter()
        .filter(|error| error.code == *code)
        .all(|error| {
            error
                .derived_from
                .as_ref()
                .is_some_and(|derived| derived.derivation == derivation_ids::CONVENTIONS_EVERY)
        })
}

fn competing_codes<'ir>(ir: &ContractIr, operation: &'ir Operation) -> Vec<&'ir ErrorCode> {
    if !answers_not_found_role(operation) {
        return Vec::new();
    }

    operation
        .errors
        .iter()
        .map(|error| &error.code)
        .filter(|code| {
            let Some(declaration) = ir.errors.get(code.as_str()) else {
                return false;
            };

            declaration.http.status == NOT_FOUND_STATUS
                && lint_owns_origin(&declaration.origin)
                && !takes_not_found_role(operation, code)
                && attached_for_the_member(operation, code)
        })
        .collect()
}

fn fix_of(code: &ErrorCode, routes: &CompetingRoutes<'_>) -> String {
    let binding = if routes.attached_by_every_only {
        format!("Set conventions.errors.derived.notFound to {code}")
    } else {
        format!(
            "Add errorRoles: {{ notFound: {code} }} on the member node of the collection that lists '{code}'"
        )
    };

    format!("{binding}, or allow seampact/not-found-role on the catalogue entry with a reason.")
}

/// The findings of the rule `seampact/not-found-role`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let ir = context.ir;
    let mut routes_by_code: IndexMap<&ErrorCode, CompetingRoutes<'_>> = IndexMap::new();

    for operation in &ir.operations {
        for code in competing_codes(ir, operation) {
            let every_only = attached_by_every_only(operation, code);
            let routes = routes_by_code
                .entry(code)
                .or_insert_with(|| CompetingRoutes {
                    operations: Vec::new(),
                    attached_by_every_only: true,
                });

            routes.operations.push(operation);
            routes.attached_by_every_only = routes.attached_by_every_only && every_only;
        }
    }

    let mut findings = Vec::new();

    for (code, routes) in &routes_by_code {
        let Some(declaration) = ir.errors.get(code.as_str()) else {
            continue;
        };
        let verb = if routes.operations.len() == 1 {
            "answers"
        } else {
            "answer"
        };

        findings.push(LintFinding {
            message: format!(
                "The 404 code '{code}' is listed on {}, which also {verb} the derived notFound code, so they have two 404 codes.",
                lint_routes_named(&routes.operations)
            ),
            fix: fix_of(code, routes),
            origin: declaration.origin.clone(),
            allow_at: vec![declaration.origin.clone()],
        });
    }

    findings
}
