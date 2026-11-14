//! The run of the half (ADR 0006 sections 2 and 3): the `schemes`, `headers` and `identities`
//! catalogues, who may call each operation and the facts of its input that access decides, and
//! their checks. It reads `schemas` for the principal schemas and input fields tree.schemas wrote,
//! and the operations tree.nodes wrote.

use seampact_ir::{HeaderId, IrMap};
use seampact_pipeline::{AccessIdentityOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

use crate::access::AccessIdentityBuilt;
use crate::headers::access_identity_headers;
use crate::identities::{AccessIdentityCatalogues, access_identity_identities};
use crate::not_ported::not_ported_yet;
use crate::operations::access_identity_operations;
use crate::report::access_identity_reporter;
use crate::schemes::{access_identity_scheme_kinds, access_identity_schemes};

/// Runs the half over the draft.
pub(crate) fn access_identity_pass_run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<AccessIdentityOutput, PassError> {
    let mut reporter = access_identity_reporter(context);
    let scheme_kinds = access_identity_scheme_kinds(reporter.raw());
    let written_schemes = access_identity_schemes(&scheme_kinds, &mut reporter)?;
    let headers = access_identity_headers(schemas, &mut reporter)?;
    let catalogues = AccessIdentityCatalogues {
        scheme_kinds: &scheme_kinds,
        headers: &headers,
        schemas: &draft.schemas,
    };
    let identities = access_identity_identities(&catalogues, schemas, &mut reporter)?;
    let built = AccessIdentityBuilt {
        schemes: written_schemes,
        identities,
    };
    let written = access_identity_operations(draft, &built, &mut reporter)?;
    // The output has no entry for a route whose access was refused: left to the lead.
    let Some(operations) = written.into_iter().collect::<Option<Vec<_>>>() else {
        return Err(not_ported_yet("accessIdentityOperations"));
    };
    let mut header_declarations = IrMap::new();

    for (id, header) in headers {
        header_declarations.insert(HeaderId::new(id), header.declaration);
    }

    Ok(AccessIdentityOutput {
        schemes: built.schemes,
        headers: header_declarations,
        identities: built.identities,
        operations,
    })
}
