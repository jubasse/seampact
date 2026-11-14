//! Relay codes (ADR 0002 section 7, ADR 0006 sections 3 and 5, row `relay.route`): a relay route
//! copies the domain codes of the public operation it relays (node and pack attachments,
//! `notFound`, and the codes that operation copied in turn), each with its declaration. The
//! boundary codes it derives itself under its own bindings, and the gateway's own (access,
//! api-wide) are not copied. A copied declaration joins this api's `errors` with its origin in the
//! public api (`api` naming it), and its contract nature joins `natures`; a code or nature this api
//! already declares, or another relay route copied first, must hold the same declaration
//! (everything but the origin), else it is refused at the route's `relays`, naming both. A copied
//! declaration's params schema is tree.schemas' to copy: one this api lacks is refused. An imported
//! api's declarations are compared only: this compiler narrows no imported error declaration yet,
//! so a domain code this api lacks is refused instead of copied.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;

use indexmap::IndexMap;
use seampact_ir::{
    DerivationId, ErrorCode, ErrorDecl, ErrorRoleBinding, IrMap, NatureDecl, NatureId, Operation,
    OperationError, OperationId, OperationRef, Origin, Schema, SchemaId,
};
use seampact_json::JsonValue;
use seampact_pipeline::{DraftOperation, PassError};

use crate::not_ported::not_ported_yet;
use crate::registry::{DeriveErrorsRegistered, DeriveErrorsRegistry};
use crate::report::{DeriveErrorsContext, DeriveErrorsReporter};
use crate::triggers::DeriveErrorsRoute;

/// The derivation of a code a relay route copies.
pub(crate) const DERIVE_ERRORS_RELAY_DERIVATION: DerivationId =
    DerivationId::from_static("relay.route");

const PACK_DERIVATION_PREFIX: &str = "pack.";

const DOMAIN_DERIVATIONS: [&str; 4] = [
    "member.notFound",
    "owner.caller",
    "relay.route",
    "node.errors",
];

/// A domain code a relay route copies from the public operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsRelayCode {
    pub(crate) code: ErrorCode,
    pub(crate) from: Vec<Origin>,
    pub(crate) example: Option<JsonValue>,
    pub(crate) roles: Option<Vec<ErrorRoleBinding>>,
    /// The public element's origin in its api, for a code attached there.
    pub(crate) origin: Option<Origin>,
}

/// What the relay routes copy: the declarations and natures this api lacks, and each route's codes
/// by its id.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct DeriveErrorsRelayCopies {
    pub(crate) errors: IndexMap<ErrorCode, DeriveErrorsRegistered>,
    pub(crate) natures: IndexMap<NatureId, NatureDecl>,
    pub(crate) codes: HashMap<OperationId, Vec<DeriveErrorsRelayCode>>,
}

/// What the relay copy reads.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsRelaySources<'sources> {
    pub(crate) context: DeriveErrorsContext<'sources>,
    pub(crate) registry: &'sources DeriveErrorsRegistry,
    pub(crate) natures: &'sources IndexMap<NatureId, NatureDecl>,
    pub(crate) schemas: &'sources IrMap<SchemaId, Schema>,
}

/// A declaration as compared: an error or a nature.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Declaration<'declaration> {
    Error(&'declaration ErrorDecl),
    Nature(&'declaration NatureDecl),
}

/// The public operation and the catalogues its codes are declared in: a workspace api's derived
/// draft, or an import.
#[derive(Debug, Clone)]
pub(crate) enum PublicSide<'run> {
    Relayed {
        api: String,
        operation: &'run DraftOperation,
        errors: &'run IrMap<ErrorCode, ErrorDecl>,
        natures: &'run IrMap<NatureId, NatureDecl>,
    },
    Imported {
        api: String,
        operation: &'run Operation,
        errors: &'run IrMap<ErrorCode, ErrorDecl>,
    },
}

/// One relay route's copy: where it is reported and what it relays.
#[derive(Debug, Clone)]
struct RelaySite {
    pointer: String,
    relays: String,
}

#[derive(Debug, Clone)]
struct FirstCopy<'declaration> {
    declaration: Declaration<'declaration>,
    site: RelaySite,
}

fn is_domain_code(_error: &OperationError) -> Result<bool, PassError> {
    Err(not_ported_yet("isDomainCode"))
}

// What two declarations of one name must agree on: everything but the origin, which names each
// api's file.
fn content_of(_declaration: Declaration<'_>) -> Result<String, PassError> {
    Err(not_ported_yet("contentOf"))
}

fn entry_of<'catalogue, K, V>(
    _catalogue: &'catalogue IrMap<K, V>,
    _id: &str,
    _what: &str,
) -> Result<&'catalogue V, PassError>
where
    K: Borrow<str> + Eq + Hash,
{
    Err(not_ported_yet("entryOf"))
}

fn public_side<'run>(
    _reporter: &DeriveErrorsReporter<'_, 'run>,
    _relays: &OperationRef,
) -> Result<PublicSide<'run>, PassError> {
    Err(not_ported_yet("publicSide"))
}

struct RelayCopier<'sources> {
    sources: DeriveErrorsRelaySources<'sources>,
    copies: DeriveErrorsRelayCopies,
    first_errors: HashMap<String, FirstCopy<'sources>>,
    first_natures: HashMap<String, FirstCopy<'sources>>,
}

impl<'sources> RelayCopier<'sources> {
    fn new(sources: DeriveErrorsRelaySources<'sources>) -> Self {
        Self {
            sources,
            copies: DeriveErrorsRelayCopies::default(),
            first_errors: HashMap::new(),
            first_natures: HashMap::new(),
        }
    }

    fn copy_route(
        &mut self,
        _route: &DeriveErrorsRoute<'_>,
        _relays: &OperationRef,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.copyRoute"))
    }

    // Whether the code's declaration is this api's, the same as one already copied, or copied now.
    fn join_declaration(
        &mut self,
        _side: &PublicSide<'_>,
        _site: &RelaySite,
        _code: &str,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("RelayCopier.joinDeclaration"))
    }

    fn params_join(
        &self,
        _site: &RelaySite,
        _declaration: &ErrorDecl,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("RelayCopier.paramsJoin"))
    }

    fn nature_joins(
        &mut self,
        _side: &PublicSide<'_>,
        _site: &RelaySite,
        _declaration: &ErrorDecl,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("RelayCopier.natureJoins"))
    }

    // A local declaration without a pointer is a core one, located at the relay route alone.
    fn same_as_local(
        &self,
        _site: &RelaySite,
        _what: &str,
        _relayed: Declaration<'_>,
        _local: Declaration<'_>,
        _local_pointer: Option<&str>,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("RelayCopier.sameAsLocal"))
    }

    fn same_as_first(
        &self,
        _site: &RelaySite,
        _what: &str,
        _relayed: Declaration<'_>,
        _first: &FirstCopy<'_>,
        _reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("RelayCopier.sameAsFirst"))
    }
}

/// The domain codes every relay route copies, with the declarations and natures this api lacks.
///
/// # Errors
///
/// A [`PassError`] when a route cannot be copied yet.
pub(crate) fn derive_errors_relay_copies(
    sources: DeriveErrorsRelaySources<'_>,
    routes: &[DeriveErrorsRoute<'_>],
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsRelayCopies, PassError> {
    let mut copier = RelayCopier::new(sources);

    for route in routes {
        if let Some(relays) = &route.operation.relays {
            copier.copy_route(route, relays, reporter)?;
        }
    }

    Ok(copier.copies)
}
