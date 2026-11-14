//! The run of the half: catalogues, then each route's scopes, proofs, requirements, field rights,
//! sort key rights and `filteredBy`, and their write into the output.

use seampact_ir::InputProof;
use seampact_pipeline::{
    AccessRightsOperation, AccessRightsOutput, DraftOperationInput, PassError,
};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::packs::AccessRightsDeriveEntry;
use crate::proofs::AccessRightsProofs;
use crate::schema_use::AccessRightsContext;
use crate::sort_keys::AccessRightsSortKeyRights;

/// The input of a route after its proofs: the input it ends with, its proofs and the body
/// proofs refused while building them.
#[derive(Debug, Clone)]
pub(crate) struct InputAfterProofs {
    pub(crate) input: Option<DraftOperationInput>,
    pub(crate) proofs: Vec<InputProof>,
    pub(crate) refused_proofs: Vec<String>,
}

pub(crate) fn access_rights_run(_context: &mut AccessRightsContext) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsRun"))
}

pub(crate) fn input_after_proofs(
    _declared: Option<&DraftOperationInput>,
    _proofs: &AccessRightsProofs,
) -> Result<InputAfterProofs, PassError> {
    Err(not_ported_yet("inputAfterProofs"))
}

pub(crate) fn write_proofs(
    _operation: &mut AccessRightsOperation,
    _proofs: AccessRightsProofs,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeProofs"))
}

pub(crate) fn write_sort_key_rights(
    _operation: &mut AccessRightsOperation,
    _rights: &AccessRightsSortKeyRights,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeSortKeyRights"))
}

pub(crate) fn entries_with<'run, 'entries>(
    _entries: &'entries [AccessRightsDeriveEntry<'run>],
    _effect: &str,
) -> Result<Vec<&'entries AccessRightsDeriveEntry<'run>>, PassError> {
    Err(not_ported_yet("entriesWith"))
}

pub(crate) fn write_catalogues(
    _output: &mut AccessRightsOutput,
    _catalogues: AccessRightsCatalogues,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeCatalogues"))
}
