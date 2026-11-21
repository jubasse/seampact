//! The diff of two contracts, or of two sets of contracts.

use indexmap::IndexMap;
use seampact_diff_table::{DiffOptions, DiffResult};
use seampact_ir::ContractIr;

use crate::DiffError;
use crate::not_ported::not_ported_yet;

/// The changes from `before` to `after` of one api, the gate and the deprecations.
///
/// # Errors
///
/// [`DiffError::NotPortedYet`] until the function is ported.
pub fn diff_contracts(
    _before: &ContractIr,
    _after: &ContractIr,
    _options: &DiffOptions,
) -> Result<DiffResult, DiffError> {
    Err(not_ported_yet("diffContracts"))
}

/// The diff of each api of two sets, keyed and ordered by api name.
///
/// An api only in `before` has every operation removed, one only in `after` every operation added.
///
/// # Errors
///
/// [`DiffError::NotPortedYet`] until the function is ported.
pub fn diff_contract_sets(
    _before: &IndexMap<String, ContractIr>,
    _after: &IndexMap<String, ContractIr>,
    _options: &DiffOptions,
) -> Result<IndexMap<String, DiffResult>, DiffError> {
    Err(not_ported_yet("diffContractSets"))
}
