//! Exact decimals for the refinement checks of examples: a bound is a decimal literal string and a
//! value a JSON number or an int64 or decimal string, compared without rounding.

use std::cmp::Ordering;

use seampact_diagnostics::InternalError;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;

/// The ECMAScript source of the decimal text the value is read from, for the body to compile.
const DECIMAL_TEXT: &str = r"^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$";

/// The ten the units are scaled by.
const TEN: i128 = 10;

/// The value `units / 10^scale`.
///
/// `units` is an `i128` for now: the TypeScript holds a `bigint`, and the workspace has no big
/// integer crate yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeSchemasDecimal {
    pub(crate) units: i128,
    pub(crate) scale: i64,
}

/// A decimal text or a number, a number read through its shortest form.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TreeSchemasDecimalSource<'text> {
    Number(f64),
    Text(&'text str),
}

/// The exact value of a decimal text or of a number's shortest form (`1e-7` included); `None` for
/// other text.
pub(crate) fn tree_schemas_decimal_of(
    value: TreeSchemasDecimalSource<'_>,
) -> Result<Option<TreeSchemasDecimal>, PassError> {
    Err(not_ported_yet("treeSchemasDecimalOf"))
}

fn aligned(a: &TreeSchemasDecimal, b: &TreeSchemasDecimal) -> Result<(i128, i128), PassError> {
    let scale = a.scale.max(b.scale);

    Ok((units_at(a, scale)?, units_at(b, scale)?))
}

/// The units of `decimal` once written at `scale`, which is not below its own.
fn units_at(decimal: &TreeSchemasDecimal, scale: i64) -> Result<i128, PassError> {
    let steps = scale
        .checked_sub(decimal.scale)
        .and_then(|difference| u32::try_from(difference).ok())
        .and_then(|difference| TEN.checked_pow(difference));
    let units = steps.and_then(|factor| decimal.units.checked_mul(factor));

    units.ok_or_else(|| {
        InternalError::new(format!(
            "tree.schemas compares the decimal {} x 10^-{} past 128 bits, which no example reaches",
            decimal.units, decimal.scale
        ))
        .into()
    })
}

/// `Less` when `a` is below `b`, `Equal` when equal, `Greater` when above.
pub(crate) fn tree_schemas_compare_decimals(
    a: &TreeSchemasDecimal,
    b: &TreeSchemasDecimal,
) -> Result<Ordering, PassError> {
    let (left, right) = aligned(a, b)?;

    Ok(left.cmp(&right))
}

/// Whether `value` is a whole multiple of a non-zero `step`.
pub(crate) fn tree_schemas_is_multiple_of(
    value: &TreeSchemasDecimal,
    step: &TreeSchemasDecimal,
) -> Result<bool, PassError> {
    Err(not_ported_yet("treeSchemasIsMultipleOf"))
}
