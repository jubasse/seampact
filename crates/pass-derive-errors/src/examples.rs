//! Route error examples (ADR 0002 section 12, ADR 0006 section 3): an example naming `error` holds
//! the code's params in `value`. tree.nodes writes it unchecked; here the code must be registered
//! and the value must fit its params, each issue located inside the value. A code without params
//! takes no example, as for a declaration's example.

use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pipeline_tree_nodes, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::{derive_errors_entries, derive_errors_member};
use crate::registry::DeriveErrorsRegistry;
use crate::report::{DeriveErrorsContext, DeriveErrorsReporter};

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
    _check: &DeriveErrorsExampleCheck<'_>,
    _example: &JsonObject,
    _pointer: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkExample"))
}
