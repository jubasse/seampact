//! Splitting a written name into segments (ADR 0007 section 2).

use crate::error::NamingError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Other,
    Lower,
    Upper,
    Digit,
}

fn kind_of(character: char) -> Kind {
    if character.is_ascii_lowercase() {
        Kind::Lower
    } else if character.is_ascii_uppercase() {
        Kind::Upper
    } else if character.is_ascii_digit() {
        Kind::Digit
    } else {
        Kind::Other
    }
}

/// Splits a written name with the four rules of ADR 0007 section 2.
///
/// Pure and total: any string gives a (possibly empty) list of non-empty `[a-z0-9]+` segments.
/// Only ASCII is looked at, so the result never depends on a locale; every other character,
/// astral ones included, separates segments.
#[must_use]
pub fn split_name(written: &str) -> Vec<String> {
    let kinds: Vec<Kind> = written.chars().map(kind_of).collect();
    let characters: Vec<char> = written.chars().collect();
    let mut segments = Vec::new();
    // Index where the current segment starts, `None` outside a run.
    let mut start: Option<usize> = None;

    for (index, kind) in kinds.iter().copied().enumerate() {
        if kind == Kind::Other {
            if let Some(from) = start {
                segments.push(lowered(&characters, from, index));
            }

            start = None;

            continue;
        }

        if start.is_none() {
            start = Some(index);

            continue;
        }

        if kind != Kind::Upper {
            continue;
        }

        let previous = index.checked_sub(1).and_then(|before| kinds.get(before));
        let next = kinds.get(index + 1).copied().unwrap_or(Kind::Other);

        // Rule 2: an uppercase letter after a lowercase letter or a digit starts a segment; so does
        // one that ends an uppercase run and is followed by a lowercase letter (`HTTPServer`).
        let starts_segment = match previous {
            Some(Kind::Lower | Kind::Digit) => true,
            Some(Kind::Upper) => next == Kind::Lower,
            _ => false,
        };

        if starts_segment && let Some(from) = start {
            segments.push(lowered(&characters, from, index));
            start = Some(index);
        }
    }

    if let Some(from) = start {
        segments.push(lowered(&characters, from, characters.len()));
    }

    segments
}

fn lowered(characters: &[char], from: usize, to: usize) -> String {
    characters
        .iter()
        .skip(from)
        .take(to - from.min(to))
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Where a written name comes from; it decides what a name without any segment means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameSource {
    /// A plain name.
    Name,
    /// An enum value, which falls back to `value<position>`.
    EnumValue,
    /// A right, whose failure the caller reports with the fix "set its `codeName`".
    Right,
}

/// The segments of a written name in its context, or the reason there is none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegmentsResult {
    /// The segments, never empty.
    Segments(Vec<String>),
    /// No segment: the caller reports it.
    NoSegment,
}

/// The options of [`segments_of`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SegmentsOptions {
    /// Replaces the segments split from the written name, for every source.
    pub code_name: Option<String>,
    /// The one-based position of an enum value, required for that source.
    pub position: Option<usize>,
}

/// The segments of a written name in its context (ADR 0007 section 2, last paragraph).
///
/// - `code_name` replaces the segments split from the written name, for every source; one that
///   yields no segment is [`SegmentsResult::NoSegment`], never the enum fallback.
/// - An enum value without a segment becomes `value<position>`; its position is required.
/// - Any other name without a segment is [`SegmentsResult::NoSegment`] too.
///
/// # Errors
///
/// [`NamingError::MissingPosition`] for an enum value without a position of one or more.
pub fn segments_of(
    written: &str,
    source: NameSource,
    options: &SegmentsOptions,
) -> Result<SegmentsResult, NamingError> {
    let position = options.position.filter(|position| *position >= 1);

    if source == NameSource::EnumValue && position.is_none() {
        let got = options
            .position
            .map_or_else(|| "undefined".to_owned(), |position| position.to_string());

        return Err(NamingError::MissingPosition(got));
    }

    let split = split_name(options.code_name.as_deref().unwrap_or(written));

    if !split.is_empty() {
        return Ok(SegmentsResult::Segments(split));
    }

    match (source, &options.code_name, position) {
        (NameSource::EnumValue, None, Some(position)) => {
            Ok(SegmentsResult::Segments(vec![format!("value{position}")]))
        }
        _ => Ok(SegmentsResult::NoSegment),
    }
}
