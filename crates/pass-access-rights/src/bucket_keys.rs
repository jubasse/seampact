//! The key sources of each bucket a route counts in, checked at that use (ADR 0002 section 9,
//! "Buckets").

use seampact_ir::IrMap;
use seampact_ir::{InputProof, Property, Requirement, Schema, SchemaId, ValueSource};
use seampact_pipeline::{DraftOperationInput, PassError};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

/// What one route's bucket uses need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsBucketKeysInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    pub(crate) requires: Vec<Requirement>,
    /// The route's input as it ends: declared, created for its proofs, or none.
    pub(crate) input: Option<&'draft DraftOperationInput>,
    pub(crate) proofs: Vec<InputProof>,
    /// The names of the route's body proofs refused while building them.
    pub(crate) refused_proofs: Vec<String>,
    pub(crate) schemas: &'draft IrMap<SchemaId, Schema>,
}

/// Why a key cannot be filled, and what to do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyProblem {
    pub(crate) why: String,
    pub(crate) fix: String,
}

const COUNTABLE_TYPES: &[&str] = &["string", "integer"];

pub(crate) fn access_rights_check_bucket_keys(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsBucketKeysInput<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsCheckBucketKeys"))
}

pub(crate) fn key_problem(
    _input: &AccessRightsBucketKeysInput<'_>,
    _source: &ValueSource,
) -> Result<Option<KeyProblem>, PassError> {
    Err(not_ported_yet("keyProblem"))
}

pub(crate) fn body_key_problem(
    _input: &AccessRightsBucketKeysInput<'_>,
    _name: &str,
) -> Result<Option<KeyProblem>, PassError> {
    Err(not_ported_yet("bodyKeyProblem"))
}

pub(crate) fn proof_key_problem(
    _input: &AccessRightsBucketKeysInput<'_>,
    _name: &str,
) -> Result<Option<KeyProblem>, PassError> {
    Err(not_ported_yet("proofKeyProblem"))
}

pub(crate) fn input_property<'draft>(
    _input: &AccessRightsBucketKeysInput<'draft>,
    _name: &str,
) -> Result<Option<&'draft Property>, PassError> {
    Err(not_ported_yet("inputProperty"))
}
