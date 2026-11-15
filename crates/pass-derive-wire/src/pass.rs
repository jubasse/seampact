//! The run of the half (ADR 0006 sections 2 and 3): the api's wire conventions (`api.wire`) and the
//! wire members the derivation table gives to `derive.wire`, each with its `derivedFrom`. Every
//! route, a relay route included, derives its own boundary from its own node and access; a relay
//! route reads from the operation it relays only the version parameter and `ETag` headers. The
//! derived parameters of a route are written in the derivation table's order, then source order.

use seampact_pipeline::{DeriveWireOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

use crate::api_wire::derive_wire_api_wire;
use crate::bodies::derive_wire_body_headers;
use crate::body_limit::derive_wire_body_limit;
use crate::buckets::derive_wire_bucket_limits;
use crate::cache::{derive_wire_cache, derive_wire_report_setting_faults};
use crate::concurrency::derive_wire_concurrency;
use crate::credentials::derive_wire_credentials;
use crate::header_tag::derive_wire_header_tag;
use crate::idempotency::{
    DeriveWireExemptions, derive_wire_check_exemptions, derive_wire_idempotency,
    derive_wire_idempotency_convention,
};
use crate::identity_headers::derive_wire_identity_headers;
use crate::lifecycle::{derive_wire_deprecation, derive_wire_maturity};
use crate::paging::derive_wire_paging;
use crate::routes::{DeriveWireScope, derive_wire_routes};
use crate::unknown_keys::{derive_wire_unknown_keys, derive_wire_unknown_keys_policy};

/// Runs the half over the draft.
pub(crate) fn derive_wire_pass_run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<DeriveWireOutput, PassError> {
    let routes = derive_wire_routes(draft, context)?;
    let mut scope = DeriveWireScope::new(draft, context, schemas);
    let unknown_keys = derive_wire_unknown_keys_policy(&scope)?;
    let idempotency = derive_wire_idempotency_convention(&mut scope)?;
    let mut exemptions = DeriveWireExemptions::default();

    derive_wire_api_wire(&mut scope)?;
    derive_wire_bucket_limits(&mut scope)?;

    for route in &routes {
        derive_wire_body_limit(route, &mut scope)?;
        derive_wire_unknown_keys(route, unknown_keys.as_ref(), &mut scope)?;
        derive_wire_credentials(route, &mut scope)?;
        derive_wire_idempotency(route, &idempotency, &mut exemptions, &mut scope)?;
        derive_wire_concurrency(route, &mut scope)?;
        derive_wire_identity_headers(route, &mut scope)?;
        derive_wire_header_tag(route, &mut scope)?;
        derive_wire_cache(route, &mut scope)?;
        derive_wire_paging(route, &mut scope)?;
        derive_wire_deprecation(route, &mut scope)?;
        derive_wire_maturity(route, &mut scope)?;
        derive_wire_body_headers(route, &mut scope)?;
    }

    derive_wire_check_exemptions(&idempotency, &exemptions, &mut scope)?;
    derive_wire_report_setting_faults(&mut scope)?;

    Ok(scope.into_output())
}
