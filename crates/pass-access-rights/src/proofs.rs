//! The rule proofs of a route: the header params and body fields its rules read, and the input a
//! proof-only route gets (ADR 0002 section 9, "Proofs").

use seampact_ir::{
    DerivedFrom, FieldWire, Identity, IdentityId, InputMediaType, InputProof, IrMap, Origin, Param,
    ProofPlacement, Requirement, RuleProof, Scheme, SchemeId, SignedIdentity, UnknownKeys,
};
use seampact_pipeline::{DraftOperationInput, PassError};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

/// What one route's proofs need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofsInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    /// The route's checked requirements, in order.
    pub(crate) requires: Vec<Requirement>,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) identities: &'draft IrMap<IdentityId, Identity>,
    pub(crate) schemes: &'draft IrMap<SchemeId, Scheme>,
}

/// The proofs of one route.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofs {
    pub(crate) headers: Vec<Param>,
    pub(crate) proofs: Vec<InputProof>,
    pub(crate) created_input: Option<DraftOperationInput>,
    pub(crate) refused_body_proofs: Vec<String>,
}

/// A header the route already takes: its name, the role that takes it and where it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RouteHeader {
    pub(crate) name: String,
    pub(crate) role: String,
    pub(crate) pointer: String,
}

/// One use of a rule's proof by a requirement.
#[derive(Debug, Clone)]
pub(crate) struct ProofUse {
    pub(crate) rule: String,
    pub(crate) proof: RuleProof,
    pub(crate) use_pointer: String,
    pub(crate) proof_pointer: String,
    pub(crate) from: Vec<Origin>,
}

const PROOF_DERIVATION: &str = "rule.proof";

const UNKNOWN_KEYS_DERIVATION: &str = "identity.unknownKeys";

const PROOF_ONLY_MEDIA: &str = "application/json";

const EMPTY_BODY_SCHEMA: &str = "ApiEmptyBody";

const AUTHORIZATION_HEADER: &str = "Authorization";

const SIGNED_INPUT_FIX: &str = "declare `input`";

const SIGNED_GET_FIX: &str =
    "serve the signed deliveries on a route with a body (a `post` with `input`)";

/// The media types of a body with fields (form and multipart), which carry no body proof.
const FIELD_MEDIA: &[InputMediaType] = &[
    InputMediaType::ApplicationXWwwFormUrlencoded,
    InputMediaType::MultipartFormData,
];

pub(crate) fn access_rights_proofs(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsProofsInput<'_>,
) -> Result<AccessRightsProofs, PassError> {
    Err(not_ported_yet("accessRightsProofs"))
}

pub(crate) fn proof_uses(
    _context: &AccessRightsContext,
    _catalogues: &AccessRightsCatalogues,
    _requires: &[Requirement],
) -> Result<Vec<ProofUse>, PassError> {
    Err(not_ported_yet("proofUses"))
}

pub(crate) fn requirement_origins(_requirement: &Requirement) -> Result<Vec<Origin>, PassError> {
    Err(not_ported_yet("requirementOrigins"))
}

pub(crate) fn name_key(_placement: &ProofPlacement, _name: &str) -> Result<String, PassError> {
    Err(not_ported_yet("nameKey"))
}

pub(crate) fn shared_by_name(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _uses: &[ProofUse],
    _placement: &ProofPlacement,
) -> Result<Vec<ProofUse>, PassError> {
    Err(not_ported_yet("sharedByName"))
}

pub(crate) fn route_headers(
    _input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<RouteHeader>, PassError> {
    Err(not_ported_yet("routeHeaders"))
}

pub(crate) fn identity_scheme_ids(
    _input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("identitySchemeIds"))
}

pub(crate) fn scheme_headers(
    _schemes: &IrMap<SchemeId, Scheme>,
    _id: &str,
) -> Result<Vec<RouteHeader>, PassError> {
    Err(not_ported_yet("schemeHeaders"))
}

pub(crate) fn csrf_headers(
    _schemes: &IrMap<SchemeId, Scheme>,
    _id: &str,
) -> Result<Vec<RouteHeader>, PassError> {
    Err(not_ported_yet("csrfHeaders"))
}

pub(crate) fn takes_route_header(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _taken_headers: &[RouteHeader],
    _use: &ProofUse,
) -> Result<bool, PassError> {
    Err(not_ported_yet("takesRouteHeader"))
}

pub(crate) fn report_schema_clash(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _first: &ProofUse,
    _later: &ProofUse,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSchemaClash"))
}

pub(crate) fn derived_from_of(_use: &ProofUse) -> Result<DerivedFrom, PassError> {
    Err(not_ported_yet("derivedFromOf"))
}

pub(crate) fn header_param_of(_use: &ProofUse) -> Result<Param, PassError> {
    Err(not_ported_yet("headerParamOf"))
}

pub(crate) fn input_proof_of(_use: &ProofUse) -> Result<InputProof, PassError> {
    Err(not_ported_yet("inputProofOf"))
}

pub(crate) fn proof_wire(
    _context: &AccessRightsContext,
    _use: &ProofUse,
) -> Result<FieldWire, PassError> {
    Err(not_ported_yet("proofWire"))
}

pub(crate) fn signed_identity_of<'draft>(
    _input: &AccessRightsProofsInput<'draft>,
) -> Result<Option<&'draft SignedIdentity>, PassError> {
    Err(not_ported_yet("signedIdentityOf"))
}

pub(crate) fn report_signed_without_input(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _identity: &SignedIdentity,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSignedWithoutInput"))
}

pub(crate) fn created_input(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsProofsInput<'_>,
    _uses: &[ProofUse],
    _identity: Option<&SignedIdentity>,
) -> Result<Option<DraftOperationInput>, PassError> {
    Err(not_ported_yet("createdInput"))
}

pub(crate) fn identity_unknown_keys(
    _identity: &SignedIdentity,
) -> Result<Option<UnknownKeys>, PassError> {
    Err(not_ported_yet("identityUnknownKeys"))
}

pub(crate) fn fits_declared_input(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsProofsInput<'_>,
    _declared: &DraftOperationInput,
    _uses: &[ProofUse],
) -> Result<bool, PassError> {
    Err(not_ported_yet("fitsDeclaredInput"))
}
