//! Route error examples (ADR 0002 section 12, ADR 0006 section 3): an example naming `error` holds
//! the code's params in `value`. tree.nodes writes it unchecked; here the code must be registered
//! and the value must fit its params, each issue located inside the value. A code without params
//! takes no example, as for a declaration's example.

use seampact_diagnostics::quote_text;
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pipeline_tree_nodes, pointer_below};

use crate::read::{derive_errors_entries, derive_errors_member, derive_errors_string};
use crate::registry::DeriveErrorsRegistry;
use crate::report::{
    DeriveErrorsContext, DeriveErrorsProblem, DeriveErrorsReporter, DeriveErrorsRule,
};
use crate::role_param_fit::derive_errors_ref_use;

/// What the example check reads.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsExampleCheck<'check> {
    pub(crate) context: DeriveErrorsContext<'check>,
    pub(crate) registry: &'check DeriveErrorsRegistry,
    pub(crate) service: &'check dyn TreeSchemaService,
}

/// Checks the `error` examples of every route.
///
/// # Errors
///
/// A [`PassError`] when an example cannot be checked yet.
pub(crate) fn derive_errors_check_route_examples(
    check: &DeriveErrorsExampleCheck<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let nodes = pipeline_tree_nodes(check.context.raw)?;

    for (_, node) in nodes.iter() {
        for (name, example) in
            derive_errors_entries(derive_errors_member(node.settings, "examples"))
        {
            check_example(
                check,
                example,
                &pointer_below(&node.pointer, &["examples", name]),
                reporter,
            )?;
        }
    }

    Ok(())
}

fn check_example(
    check: &DeriveErrorsExampleCheck<'_>,
    example: &JsonObject,
    pointer: &str,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let Some(code) = derive_errors_string(example, "error") else {
        return Ok(());
    };
    let quoted = quote_text(code);
    let Some(registered) = check.registry.get(code) else {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorUnknown,
            message: format!(
                "the example names error code {quoted}, which no layer or node declares and which is no default code"
            ),
            fix: format!("declare {quoted} with a status in 'errors', or name a declared code"),
            pointer: pointer_below(pointer, &["error"]),
            related: Vec::new(),
        })?;

        return Ok(());
    };
    let value_pointer = pointer_below(pointer, &["value"]);
    let Some(value) = derive_errors_member(example, "value") else {
        return Ok(());
    };
    let Some(params) = &registered.declaration.params else {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorExample,
            message: format!(
                "the example of error {quoted} holds a value, but the code has no params for it to show"
            ),
            fix: format!("declare params on {quoted}, or remove the example"),
            pointer: value_pointer,
            related: Vec::new(),
        })?;

        return Ok(());
    };

    for issue in check
        .service
        .check_example(value, &derive_errors_ref_use(params))?
    {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorExample,
            message: format!(
                "the example of error {quoted} does not fit its params: {}",
                issue.message
            ),
            fix: "correct the example to fit the params".to_owned(),
            pointer: format!("{value_pointer}{}", issue.pointer),
            related: Vec::new(),
        })?;
    }

    Ok(())
}
