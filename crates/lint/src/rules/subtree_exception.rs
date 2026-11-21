//! A safety exception written on a node that is neither a route nor a surface root.

use std::collections::HashSet;

use seampact_ir::{
    KnownAccessRef, KnownCsrfRef, KnownIdempotencyRef, KnownUnknownQueryRef, Operation, Origin,
};

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::{
    lint_group_by_origin, lint_node_of, lint_origin_key, lint_owns_origin, lint_routes_named,
};

/// The tree of grammar 08: an exception written elsewhere, as the api-wide
/// `conventions.query.unknownKeys`, is a convention, not a node, so the rule never reads it.
const TREE_PREFIX: &str = "/surfaces/";

/// A surface root is `/surfaces/<name>`, the one place above a route an exception is meant for.
fn is_surface_root(pointer: &str) -> bool {
    pointer
        .strip_prefix(TREE_PREFIX)
        .is_some_and(|name| !name.is_empty() && !name.contains('/'))
}

/// One exception an operation carries.
struct Exception<'ir> {
    /// The written form, for the message.
    written: &'static str,
    origin: &'ir Origin,
    operation: &'ir Operation,
}

/// The exception written at `origin`, when the contract wrote it on a node of the tree.
fn exception_at<'ir>(
    operation: &'ir Operation,
    written: &'static str,
    origin: &'ir Origin,
) -> Option<Exception<'ir>> {
    if lint_owns_origin(origin) && origin.pointer.starts_with(TREE_PREFIX) {
        return Some(Exception {
            written,
            origin,
            operation,
        });
    }

    None
}

fn exceptions_of(operation: &Operation) -> Vec<Exception<'_>> {
    let mut found: Vec<Exception<'_>> = Vec::new();

    match KnownAccessRef::try_from(&operation.access) {
        Ok(KnownAccessRef::Public(access)) => {
            found.extend(exception_at(operation, "access.public", &access.origin));
        }
        Ok(KnownAccessRef::Optional(access)) => {
            found.extend(exception_at(
                operation,
                "access.optionalAuth",
                &access.origin,
            ));
        }
        Ok(KnownAccessRef::Identity(_)) | Err(_) => {}
    }

    if let Some(Ok(KnownCsrfRef::Exempt(csrf))) =
        operation.csrf.as_ref().map(KnownCsrfRef::try_from)
    {
        found.extend(exception_at(operation, "csrf.exempt", &csrf.origin));
    }

    if let Some(Ok(KnownIdempotencyRef::Exempt(idempotency))) = operation
        .idempotency
        .as_ref()
        .map(KnownIdempotencyRef::try_from)
    {
        found.extend(exception_at(
            operation,
            "idempotency.exempt",
            &idempotency.origin,
        ));
    }

    if let Ok(KnownUnknownQueryRef::Ignore(query)) =
        KnownUnknownQueryRef::try_from(&operation.unknown_query)
    {
        found.extend(exception_at(
            operation,
            "unknownQuery: { ignore }",
            &query.origin,
        ));
    }

    found
}

/// The findings of the rule `seampact/subtree-exception`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let operations = &context.ir.operations;
    let routes: HashSet<String> = operations
        .iter()
        .map(|operation| lint_origin_key(&operation.origin))
        .collect();
    let misplaced = operations
        .iter()
        .flat_map(exceptions_of)
        .filter(|exception| {
            let node = lint_node_of(exception.origin);

            !routes.contains(&lint_origin_key(&node)) && !is_surface_root(&node.pointer)
        })
        .map(|exception| (exception.origin, exception));
    let mut findings = Vec::new();

    for group in lint_group_by_origin(misplaced) {
        let Some(first) = group.entries.first() else {
            continue;
        };
        let node = lint_node_of(group.origin);
        let operations: Vec<&Operation> = group
            .entries
            .iter()
            .map(|exception| exception.operation)
            .collect();

        findings.push(LintFinding {
            message: format!(
                "The exception {} is written on '{}', which is neither a route nor a surface root, so it reaches {}.",
                first.written,
                node.pointer,
                lint_routes_named(&operations)
            ),
            fix: "Move the exception to the route or the surface root it is meant for, or allow seampact/subtree-exception on that node with a reason."
                .to_owned(),
            origin: group.origin.clone(),
            allow_at: vec![node],
        });
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_surface_root_is_one_name_below_the_surfaces() {
        assert!(is_surface_root("/surfaces/app"));
        assert!(is_surface_root("/surfaces/\u{1F600}"));
        assert!(is_surface_root("/surfaces/a\nb"));
    }

    #[test]
    fn anything_else_is_not_a_surface_root() {
        for pointer in [
            "/surfaces/",
            "/surfaces/app/",
            "/surfaces/app/routes",
            "/surfaces",
            "surfaces/app",
            "",
        ] {
            assert!(!is_surface_root(pointer), "pointer {pointer:?}");
        }
    }
}
