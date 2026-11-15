//! The run of the half (ADR 0006 sections 2 and 3): the `natures` catalogue, the error registry
//! (`errors`: the catalogue, the declarations on tree nodes, the default codes and the relay
//! routes' copies), the checks of every role binding and route error example, and each operation's
//! `errors`. It reads `schemas` for the params a bound code declares and the sensitive values a
//! code's params carry (`noStore`), the operation members the derivation table's triggers name,
//! and the public operation a relay route relays.

use seampact_ir::{ErrorCode, ErrorDecl, IrMap, NatureDecl, NatureId};
use seampact_pipeline::{
    DeriveErrorsOutput, DraftIr, HalfContext, PassError, TreeSchemaService, pipeline_tree_nodes,
};

use crate::bindings::{DeriveErrorsBindingCheck, derive_errors_check_bindings};
use crate::examples::{DeriveErrorsExampleCheck, derive_errors_check_route_examples};
use crate::natures::derive_errors_natures;
use crate::operations::{
    DeriveErrorsOperationsSources, derive_errors_operations, derive_errors_routes,
};
use crate::registry::{DeriveErrorsRegistrySources, derive_errors_registry};
use crate::relays::{DeriveErrorsRelaySources, derive_errors_relay_copies};
use crate::report::derive_errors_reporter;

/// Runs the half over the draft.
pub(crate) fn derive_errors_pass_run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<DeriveErrorsOutput, PassError> {
    let mut reporter = derive_errors_reporter(context);
    let readers = reporter.context();
    let natures = derive_errors_natures(readers, &mut reporter)?;
    let mut output_natures: IrMap<NatureId, NatureDecl> = IrMap::new();

    for (id, nature) in &natures {
        output_natures.insert(id.clone(), nature.clone());
    }

    let registry = derive_errors_registry(
        &DeriveErrorsRegistrySources {
            context: readers,
            natures: &natures,
            schemas: &draft.schemas,
            service: schemas,
        },
        &mut reporter,
    )?;
    let mut output_errors: IrMap<ErrorCode, ErrorDecl> = IrMap::new();

    for (code, registered) in &registry {
        output_errors.insert(code.clone(), registered.declaration.clone());
    }

    let check = DeriveErrorsBindingCheck {
        context: readers,
        registry: &registry,
        schemas: &draft.schemas,
        service: schemas,
    };
    let bound = derive_errors_check_bindings(&check, &mut reporter)?;

    derive_errors_check_route_examples(
        &DeriveErrorsExampleCheck {
            context: readers,
            registry: &registry,
            service: schemas,
        },
        &mut reporter,
    )?;

    let nodes = pipeline_tree_nodes(readers.raw)?;
    let routes = derive_errors_routes(draft, &nodes)?;
    let relayed = derive_errors_relay_copies(
        DeriveErrorsRelaySources {
            context: readers,
            registry: &registry,
            natures: &natures,
            schemas: &draft.schemas,
        },
        &routes,
        &mut reporter,
    )?;

    for (id, nature) in &relayed.natures {
        output_natures.insert(id.clone(), nature.clone());
    }

    let mut with_relays = registry.clone();

    for (code, copied) in &relayed.errors {
        output_errors.insert(code.clone(), copied.declaration.clone());
        with_relays.insert(code.clone(), copied.clone());
    }

    let operation_errors = derive_errors_operations(
        &DeriveErrorsOperationsSources {
            check: DeriveErrorsBindingCheck {
                registry: &with_relays,
                ..check
            },
            draft,
            nodes: &nodes,
            bound: &bound,
            relay_codes: &relayed.codes,
        },
        &routes,
        &mut reporter,
    )?;

    Ok(DeriveErrorsOutput {
        errors: output_errors,
        natures: output_natures,
        operation_errors,
    })
}
