//! The unit readers tree and derive both need (ADR 0002 section 4): a size (`1MiB`) in bytes and
//! a duration (`150ms`, `24h`) in milliseconds.
//!
//! A value is read only when it matches the grammar's own pattern (`common` definitions `size`
//! and `duration`), so the reader never accepts more than the authoring schema does.

use std::sync::LazyLock;

use regress::Regex;
use seampact_authoring::JsonObjectExt;
use seampact_diagnostics::InternalError;
use seampact_json::MAX_SAFE_INTEGER;

use super::authoring_schema::authoring_schema;

const SIZE_UNITS: [(&str, u64); 3] = [("B", 1), ("KiB", 1024), ("MiB", 1024 * 1024)];

const DURATION_UNITS: [(&str, u64); 5] = [
    ("ms", 1),
    ("s", 1000),
    ("m", 60_000),
    ("h", 3_600_000),
    ("d", 86_400_000),
];

/// A grammar definition read as a number with a unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitKind {
    /// `size`, in bytes.
    Size,
    /// `duration`, in milliseconds.
    Duration,
}

impl UnitKind {
    const fn definition(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Duration => "duration",
        }
    }
}

/// The units of a grammar definition with the value of each in its base unit; a test keeps them
/// equal to the pattern's units.
#[must_use]
pub const fn unit_table(kind: UnitKind) -> &'static [(&'static str, u64)] {
    match kind {
        UnitKind::Size => &SIZE_UNITS,
        UnitKind::Duration => &DURATION_UNITS,
    }
}

/// The grammar's pattern of a unit definition.
///
/// # Errors
///
/// An [`InternalError`] when the authoring grammar has no such pattern.
pub fn unit_pattern(kind: UnitKind) -> Result<&'static str, InternalError> {
    let definition = kind.definition();

    authoring_schema("common")?
        .object("$defs")
        .and_then(|definitions| definitions.object(definition))
        .and_then(|found| found.string("pattern"))
        .ok_or_else(|| {
            InternalError::new(format!("the authoring grammar has no {definition} pattern"))
        })
}

// The text split into its digits and its unit, once the grammar's pattern accepted it.
static DIGITS_AND_UNIT: LazyLock<Result<Regex, String>> =
    LazyLock::new(|| Regex::new("^([0-9]+)(.+)$").map_err(|error| error.to_string()));

static SIZE_PATTERN: LazyLock<Result<Regex, String>> = LazyLock::new(|| compile(UnitKind::Size));

static DURATION_PATTERN: LazyLock<Result<Regex, String>> =
    LazyLock::new(|| compile(UnitKind::Duration));

fn compile(kind: UnitKind) -> Result<Regex, String> {
    let pattern = unit_pattern(kind).map_err(|error| error.what().to_owned())?;

    Regex::new(pattern).map_err(|error| error.to_string())
}

fn compiled(
    cell: &'static LazyLock<Result<Regex, String>>,
) -> Result<&'static Regex, InternalError> {
    cell.as_ref()
        .map_err(|what| InternalError::new(what.clone()))
}

fn parse(kind: UnitKind, text: &str) -> Result<Option<u64>, InternalError> {
    let pattern = match kind {
        UnitKind::Size => compiled(&SIZE_PATTERN)?,
        UnitKind::Duration => compiled(&DURATION_PATTERN)?,
    };

    if pattern.find(text).is_none() {
        return Ok(None);
    }

    let Some(found) = compiled(&DIGITS_AND_UNIT)?.find(text) else {
        return Ok(None);
    };
    let group_text = |index: usize| found.group(index).and_then(|range| text.get(range));
    let (Some(digits), Some(unit)) = (group_text(1), group_text(2)) else {
        return Err(InternalError::new(format!(
            "the {} text {text} has no digits and unit",
            kind.definition()
        )));
    };
    let Some((_, factor)) = unit_table(kind).iter().find(|(name, _)| *name == unit) else {
        return Err(InternalError::new(format!(
            "the {} unit {unit} has no reading",
            kind.definition()
        )));
    };

    // Digits beyond u64 are beyond a safe integer too, as is any product the check below refuses.
    let value = digits
        .parse::<u64>()
        .ok()
        .and_then(|count| count.checked_mul(*factor));

    Ok(value.filter(|value| *value <= MAX_SAFE_INTEGER.unsigned_abs()))
}

/// A size in bytes (`1MiB` is 1048576); `None` for a text outside the grammar or beyond a safe
/// integer.
///
/// # Errors
///
/// An [`InternalError`] when the grammar's pattern accepts a unit this reader has no value for.
pub fn parse_size(text: &str) -> Result<Option<u64>, InternalError> {
    parse(UnitKind::Size, text)
}

/// A duration in milliseconds (`24h` is 86400000); `None` for a text outside the grammar or too
/// large.
///
/// # Errors
///
/// An [`InternalError`] when the grammar's pattern accepts a unit this reader has no value for.
pub fn parse_duration(text: &str) -> Result<Option<u64>, InternalError> {
    parse(UnitKind::Duration, text)
}
