//! The write rules every output's `merge_into` shares.
//!
//! An `owned` or `default` member is set where absent; an `elements` list is extended. A write over
//! a value already set, a write into a member the draft does not have, or a per-operation output of
//! another length than the draft's operations is an [`InternalError`] naming the half, the member
//! and the operation.

use seampact_diagnostics::InternalError;
use seampact_ir::{IrMap, TypeUse, UnknownKeys};

use crate::{DraftOperation, DraftOperationInput, Half};

/// Where a merge writes: the half and, for a per-operation member, the operation.
#[derive(Debug, Clone)]
pub(crate) struct Site {
    pub(crate) half: Half,
    pub(crate) operation: Option<String>,
}

impl Site {
    pub(crate) fn of_draft(half: Half) -> Self {
        Self {
            half,
            operation: None,
        }
    }

    pub(crate) fn of_operation(half: Half, operation: String) -> Self {
        Self {
            half,
            operation: Some(operation),
        }
    }

    pub(crate) fn describe(&self, field: &str) -> String {
        match &self.operation {
            Some(operation) => format!("{field} of operation {operation} ({})", self.half),
            None => format!("{field} ({})", self.half),
        }
    }
}

/// Sets `slot` to `value` where it is absent.
pub(crate) fn write_once<T>(
    slot: &mut Option<T>,
    value: T,
    field: &str,
    site: &Site,
) -> Result<(), InternalError> {
    if slot.is_some() {
        return Err(InternalError::new(format!(
            "{} is already set; a half writes a member once and never over another's",
            site.describe(field)
        )));
    }

    *slot = Some(value);

    Ok(())
}

/// Sets `slot` to `value` where it is absent, when the half has a value to write.
pub(crate) fn write_once_if_some<T>(
    slot: &mut Option<T>,
    value: Option<T>,
    field: &str,
    site: &Site,
) -> Result<(), InternalError> {
    match value {
        Some(value) => write_once(slot, value, field, site),
        None => Ok(()),
    }
}

/// Moves a catalogue into a draft catalogue that is still empty.
pub(crate) fn write_catalogue<K, V>(
    slot: &mut IrMap<K, V>,
    value: IrMap<K, V>,
    field: &str,
    site: &Site,
) -> Result<(), InternalError> {
    if !slot.is_empty() {
        return Err(InternalError::new(format!(
            "{} is already set; a catalogue has one owner that writes it once",
            site.describe(field)
        )));
    }

    *slot = value;

    Ok(())
}

/// Moves a list into a draft list that is still empty.
pub(crate) fn write_list<T>(
    slot: &mut Vec<T>,
    value: Vec<T>,
    field: &str,
    site: &Site,
) -> Result<(), InternalError> {
    if !slot.is_empty() {
        return Err(InternalError::new(format!(
            "{} is already set; its owner writes it once",
            site.describe(field)
        )));
    }

    *slot = value;

    Ok(())
}

/// The member a half appends to or writes into, which an earlier half had to create.
pub(crate) fn existing<'slot, T>(
    slot: &'slot mut Option<T>,
    field: &str,
    site: &Site,
) -> Result<&'slot mut T, InternalError> {
    slot.as_mut().ok_or_else(|| {
        InternalError::new(format!(
            "{} has nothing to write into: no earlier half wrote it",
            site.describe(field)
        ))
    })
}

/// Pairs each draft operation with its entry of a per-operation output, in draft order.
pub(crate) fn operations_with<T>(
    operations: &mut [DraftOperation],
    entries: Vec<T>,
    half: Half,
) -> Result<Vec<(&mut DraftOperation, T, Site)>, InternalError> {
    if operations.len() != entries.len() {
        return Err(InternalError::new(format!(
            "{half} wrote {} per-operation entries for {} operations",
            entries.len(),
            operations.len()
        )));
    }

    Ok(operations
        .iter_mut()
        .zip(entries)
        .enumerate()
        .map(|(position, (operation, entry))| {
            let site = Site::of_operation(half, operation.label(position));

            (operation, entry, site)
        })
        .collect())
}

/// Sets the `unknownKeys` of the schema reference of an operation's input, where absent.
pub(crate) fn write_unknown_keys(
    input: &mut Option<DraftOperationInput>,
    unknown_keys: Option<UnknownKeys>,
    site: &Site,
) -> Result<(), InternalError> {
    let Some(unknown_keys) = unknown_keys else {
        return Ok(());
    };
    let input = existing(input, "input", site)?;
    let TypeUse::Ref(reference) = &mut input.schema else {
        return Err(InternalError::new(format!(
            "{} has no schema reference to hold unknownKeys",
            site.describe("input.schema")
        )));
    };

    write_once(
        &mut reference.unknown_keys,
        unknown_keys,
        "input.schema.unknownKeys",
        site,
    )
}
